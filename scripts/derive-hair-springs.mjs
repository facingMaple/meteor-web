#!/usr/bin/env node
// Derive a Web spring-bone hair rig from the runtime mesh of a character whose
// source archive ships no hair chain (Ningguang: every hair vertex is bound to
// the head bone, so nothing moves).
//
// This is a Web approximation, not the original MMD rigid-body solver, and it
// is derived from the built surface instead of a source bone hierarchy. It only
// touches vertices whose every face is a hair material; decal/body vertices
// sharing the surface stay rigid.
//
// Usage: node scripts/derive-hair-springs.mjs --appearance ningguang [--dry-run]
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const HAIR_NAMES = ['髪', '发', 'hair', 'hairfront', 'hairback', 'hairside'];
const HEAD_BONE = 13;          // native BCN head slot used by every spring root
const NATIVE_COUNT = 30;
const MIN_STRAND_VERTICES = 30; // shorter fragments stay rigid
const JOINT_SPACING = 2.0;      // world units per spring bone
const MAX_BONES_PER_STRAND = 4;

const args = process.argv.slice(2);
const value = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const appearance = value('--appearance');
const dryRun = args.includes('--dry-run');
// Some archives leave hair layers without a 髪 name; --materials adds them.
const extraMaterials = (value('--materials', '') ?? '')
  .split(',')
  .map(entry => Number(entry.trim()))
  .filter(entry => Number.isInteger(entry) && entry >= 0);
if (!appearance) {
  console.error('用法: node scripts/derive-hair-springs.mjs --appearance <id> [--dry-run]');
  process.exit(2);
}

const dir = new URL(`dist/assets/enhanced/${appearance}/`, ROOT);
const meshPath = new URL('mesh.json', dir);
const manifestPath = new URL('manifest.json', dir);
const skin = JSON.parse(await readFile(meshPath, 'utf8'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

if (skin.secondaryMotion) {
  console.error(`${appearance} 已有 secondaryMotion（${skin.secondaryMotion.bones?.length ?? 0} 根），拒绝覆盖。`);
  process.exit(1);
}

const V = i => [skin.positions[i * 3], skin.positions[i * 3 + 1], skin.positions[i * 3 + 2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = v => Math.hypot(v[0], v[1], v[2]);
const norm = v => { const l = len(v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// Rotation that maps +Y onto `direction` with a stable Z reference (matches the
// Blender recipe `direction.to_track_quat('Y', 'Z')`). Returned as [x,y,z,w].
function quatFromY(direction) {
  const y = norm(direction);
  let zRef = [0, 0, 1];
  if (Math.abs(dot(y, zRef)) > 0.999) zRef = [0, 1, 0];
  const x = norm([
    y[1] * zRef[2] - y[2] * zRef[1],
    y[2] * zRef[0] - y[0] * zRef[2],
    y[0] * zRef[1] - y[1] * zRef[0],
  ]);
  const z = [
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ];
  // Basis columns are x, y, z.
  const m00 = x[0], m01 = y[0], m02 = z[0];
  const m10 = x[1], m11 = y[1], m12 = z[1];
  const m20 = x[2], m21 = y[2], m22 = z[2];
  const trace = m00 + m11 + m22;
  let q;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, 0.25 * s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  const n = Math.hypot(...q) || 1;
  return q.map(v => +(v / n).toFixed(9));
}

// ---- hair vertices -------------------------------------------------------
const hairMaterials = [...new Set([
  ...skin.materials
    .map((material, index) => [index, `${material.sourceName ?? material.name}`.toLowerCase()])
    .filter(([, name]) => HAIR_NAMES.some(token => name.includes(token.toLowerCase())))
    .map(([index]) => index),
  ...extraMaterials,
])].sort((a, b) => a - b);
if (!hairMaterials.length) {
  console.error(`${appearance} 找不到头发材质（按材质名称匹配失败）`);
  process.exit(1);
}
const hairSet = new Set(hairMaterials);
const hairFaces = skin.faces.filter(face => hairSet.has(face.material));
const bodyVertices = new Set();
for (const face of skin.faces) if (!hairSet.has(face.material)) for (const index of face.indices) bodyVertices.add(index);
const hairVertices = new Set();
for (const face of hairFaces) for (const index of face.indices) if (!bodyVertices.has(index)) hairVertices.add(index);

// ---- connected strands ---------------------------------------------------
const adjacency = new Map();
const link = (a, b) => {
  if (!adjacency.has(a)) adjacency.set(a, []);
  if (!adjacency.has(b)) adjacency.set(b, []);
  adjacency.get(a).push(b);
  adjacency.get(b).push(a);
};
for (const face of hairFaces) {
  const [a, b, c] = face.indices;
  if (!hairVertices.has(a) || !hairVertices.has(b) || !hairVertices.has(c)) continue;
  link(a, b); link(b, c); link(c, a);
}
const seen = new Set();
const strands = [];
for (const start of hairVertices) {
  if (seen.has(start)) continue;
  const stack = [start];
  seen.add(start);
  const members = [];
  while (stack.length) {
    const current = stack.pop();
    members.push(current);
    for (const next of adjacency.get(current) ?? []) if (!seen.has(next) && hairVertices.has(next)) { seen.add(next); stack.push(next); }
  }
  if (members.length >= MIN_STRAND_VERTICES) strands.push(members);
}
strands.sort((a, b) => b.length - a.length);

const headPosition = skin.bodyRig.bones[HEAD_BONE].position;
const bones = [];
const weights = new Map(); // vertex -> Map(boneSlot -> weight)
const stats = [];

for (const members of strands) {
  const memberSet = new Set(members);
  // Root = the strand vertex closest to the head joint.
  let root = members[0], best = Infinity;
  for (const index of members) {
    const d = len(sub(V(index), headPosition));
    if (d < best) { best = d; root = index; }
  }
  // Farthest vertex (BFS over the strand) fixes the tip and the spine path.
  const parent = new Map([[root, -1]]);
  const order = [root];
  for (let cursor = 0; cursor < order.length; cursor++) {
    const current = order[cursor];
    for (const next of adjacency.get(current) ?? []) {
      if (!memberSet.has(next) || parent.has(next)) continue;
      parent.set(next, current);
      order.push(next);
    }
  }
  let tip = root, longest = -1;
  for (const index of order) {
    const d = len(sub(V(index), V(root)));
    if (d > longest) { longest = d; tip = index; }
  }
  const path = [];
  for (let cursor = tip; cursor !== -1 && cursor !== undefined; cursor = parent.get(cursor)) path.push(cursor);
  path.reverse();
  if (path.length < 2) continue;

  // Resample the spine by arc length so joints are evenly spaced.
  const points = path.map(V);
  const arc = [0];
  for (let i = 1; i < points.length; i++) arc.push(arc[i - 1] + len(sub(points[i], points[i - 1])));
  const total = arc.at(-1);
  const joints = Math.max(2, Math.min(MAX_BONES_PER_STRAND + 1, Math.round(total / JOINT_SPACING) + 1));
  const sampleAt = distance => {
    let i = 1;
    while (i < arc.length && arc[i] < distance) i++;
    if (i >= arc.length) return points.at(-1);
    const t = (distance - arc[i - 1]) / Math.max(1e-9, arc[i] - arc[i - 1]);
    return add(points[i - 1], mul(sub(points[i], points[i - 1]), t));
  };
  const jointsPositions = Array.from({ length: joints }, (_, i) => sampleAt((total * i) / (joints - 1)));
  const chainStart = bones.length;
  for (let i = 0; i < jointsPositions.length - 1; i++) {
    const position = jointsPositions[i];
    const tail = jointsPositions[i + 1];
    const direction = sub(tail, position);
    if (len(direction) < 0.001) continue;
    const depth = i;
    bones.push({
      name: `${appearance}_hair_${chainStart + i}`,
      parent: i === 0 ? HEAD_BONE : NATIVE_COUNT + chainStart + i - 1,
      position: position.map(v => +v.toFixed(5)),
      tail: tail.map(v => +v.toFixed(5)),
      rotation: quatFromY(direction),
      depth,
      stiffness: depth === 0 ? 220 : depth === 1 ? 150 : 110,
      damping: depth === 0 ? 30 : 24,
      maxAngle: depth === 0 ? 0.01 : 0.025,
      gravity: depth === 0 ? 0 : 0.003,
      follow: 0.98,
      globalMaxAngle: 0.04,
      radius: 0.16,
    });
  }

  // Weight each strand vertex to the two nearest joints of its own chain.
  for (const index of members) {
    const point = V(index);
    let bestSegment = 0, bestDistance = Infinity, bestT = 0;
    for (let i = 0; i < jointsPositions.length - 1; i++) {
      const a = jointsPositions[i], b = jointsPositions[i + 1];
      const ab = sub(b, a);
      const abLen2 = Math.max(1e-9, dot(ab, ab));
      const t = Math.max(0, Math.min(1, dot(sub(point, a), ab) / abLen2));
      const closest = add(a, mul(ab, t));
      const distance = len(sub(point, closest));
      if (distance < bestDistance) { bestDistance = distance; bestSegment = i; bestT = t; }
    }
    const perVertex = new Map();
    const local = bestSegment + bestT; // continuous position along the chain
    const chainBones = jointsPositions.length - 1;
    for (let i = 0; i < chainBones; i++) {
      const distance = Math.abs(local - (i + 0.5));
      const weight = Math.max(0, 1 - distance);
      if (weight > 0) perVertex.set(NATIVE_COUNT + chainStart + i, weight);
    }
    // Near the scalp, blend back into the head so the roots cannot detach.
    const rootBlend = Math.max(0, 1 - local / 0.75);
    if (rootBlend > 0) {
      perVertex.set(HEAD_BONE, rootBlend * 1.2);
    }
    if (!perVertex.size) continue;
    weights.set(index, perVertex);
  }
  stats.push({
    vertices: members.length,
    joints: jointsPositions.length,
    bones: jointsPositions.length - 1,
    length: +total.toFixed(2),
    root: V(root).map(v => +v.toFixed(2)),
    tip: V(tip).map(v => +v.toFixed(2)),
  });
}

if (!bones.length) {
  console.error('没有可用的发束，未修改文件。');
  process.exit(1);
}

// ---- apply weights -------------------------------------------------------
for (const [index, perVertex] of weights) {
  const ranked = [...perVertex.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const sum = ranked.reduce((total, [, weight]) => total + weight, 0) || 1;
  for (let k = 0; k < 4; k++) {
    const entry = ranked[k];
    skin.skinIndices[index * 4 + k] = entry ? entry[0] : 0;
    skin.skinWeights[index * 4 + k] = entry ? +(entry[1] / sum).toFixed(6) : 0;
  }
}

const rig = {
  schema: 1,
  type: 'web-spring-bone',
  nativeBoneCount: NATIVE_COUNT,
  bones,
  hairMaterials,
  vertexCount: weights.size,
  colliders: [{ shape: 'sphere', bone: HEAD_BONE, offset: [0, 0, 0], radius: 1.8 }],
  provenance:
    'Derived from the built runtime surface: no source hair chain exists in the .blend archive. ' +
    'Strands are the connected hair-material components; joints are resampled along each spine, ' +
    'weights blend the two nearest joints and fade into the head at the root. ' +
    'Restrained Web springs, not the original MMD rigid-body solver.',
};
skin.secondaryMotion = rig;

manifest.stats = { ...manifest.stats, secondaryBones: bones.length };
manifest.retarget = { ...manifest.retarget, hairPhysics: true, hairPhysicsProfile: 'web-spring-bone-v2-restrained' };
// limits live under provenance in every shipped manifest.
manifest.provenance = manifest.provenance ?? {};
manifest.provenance.limits = [
  ...(manifest.provenance.limits ?? manifest.limits ?? []).filter(line => !/^\s*Hair\b/i.test(line)),
  'Hair (髪 and the unnamed back locks) uses a Web spring rig derived from the built surface; hairpins and earrings stay rigid.',
];
delete manifest.limits;

const meshJSON = JSON.stringify(skin, null, 0);
const manifestJSON = JSON.stringify(manifest, null, 2);
const digest = value => createHash('sha256').update(value).digest('hex');
console.log(JSON.stringify({
  appearance,
  strands: stats,
  bones: bones.length,
  reweightedVertices: weights.size,
  hairMaterials,
  meshSHA256: digest(meshJSON),
  manifestSHA256: digest(manifestJSON),
  dryRun,
}, null, 1));

if (!dryRun) {
  // Keep the on-disk formatting the build scripts use: compact mesh, indented manifest.
  await writeFile(meshPath, meshJSON);
  await writeFile(manifestPath, manifestJSON);
  const evidence = new URL(`work/${appearance}-hair-springs-${new Date().toISOString().slice(0, 10)}/`, ROOT);
  await import('node:fs/promises').then(fs => fs.mkdir(evidence, { recursive: true }));
  await writeFile(new URL('derive-report.json', evidence), JSON.stringify({ appearance, stats, bones, reweightedVertices: weights.size, meshSHA256: digest(meshJSON) }, null, 2));
  console.log(`已写入 ${meshPath.pathname} 与 manifest.json`);
}
