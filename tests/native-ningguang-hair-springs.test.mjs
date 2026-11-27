import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.js';
import { validateHairRig } from '../dist/hair-springs.js';
import { createNativeCharacter, loadNativeCharacterData } from '../dist/native-character.js';

// The Ningguang archive is a .blend with no hair chain, so every hair vertex was
// bound to the head and never moved. The runtime surface now carries a derived
// Web spring rig; these checks hold without the (local-only) source archive.
const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url)));
const fileFetch = async url => {
  try { return new Response(await readFile(new URL(url))); }
  catch { return new Response('', { status: 404 }); }
};
const withFetch = async callback => {
  const before = globalThis.fetch; globalThis.fetch = fileFetch;
  try { return await callback(); } finally { globalThis.fetch = before; }
};

const data = await withFetch(() => loadNativeCharacterData(0));
const skin = await json('../dist/assets/enhanced/ningguang/mesh.json');
const rig = skin.secondaryMotion;
const vector = (array, target = new THREE.Vector3()) => target.fromArray(array);

test('Ningguang hair rig satisfies the runtime spring contract', () => {
  assert.ok(rig, 'secondaryMotion must exist');
  assert.equal(validateHairRig(rig, 30), rig.bones.length);
  assert.equal(rig.schema, 1);
  assert.equal(rig.type, 'web-spring-bone');
  assert.equal(rig.nativeBoneCount, 30);
  assert.ok(rig.bones.length > 8 && rig.bones.length <= 128);
  assert.ok(rig.hairMaterials.includes(11), 'the 髪 material drives the rig');
  assert.ok(rig.vertexCount > 500, 'a meaningful share of the hair must be reweighted');
  assert.equal(rig.colliders.length, 1);
  assert.equal(rig.colliders[0].shape, 'sphere');
  assert.equal(rig.colliders[0].bone, 13, 'a skull collider keeps bangs off the face');
});

test('Only hair vertices receive spring influences and every weight row stays normalized', () => {
  const hairMaterials = new Set(rig.hairMaterials);
  const hairVertices = new Set();
  for (const face of skin.faces) if (hairMaterials.has(face.material)) for (const index of face.indices) hairVertices.add(index);
  const bodyVertices = new Set();
  for (const face of skin.faces) if (!hairMaterials.has(face.material)) for (const index of face.indices) bodyVertices.add(index);
  let driven = 0;
  for (let v = 0; v < skin.vertexCount; v++) {
    const indices = skin.skinIndices.slice(v * 4, v * 4 + 4);
    const weights = skin.skinWeights.slice(v * 4, v * 4 + 4);
    assert.ok(Math.abs(weights.reduce((a, b) => a + b, 0) - 1) < 1e-3, `weights must sum to 1 at vertex ${v}`);
    assert.ok(indices.every(i => Number.isInteger(i) && i >= 0 && i < 30 + rig.bones.length));
    const spring = indices.some((index, slot) => index >= 30 && weights[slot] > 0);
    if (spring) {
      driven++;
      assert.ok(hairVertices.has(v), `vertex ${v} uses a spring bone without being hair`);
      assert.equal(bodyVertices.has(v), false, 'a shared body vertex must stay rigid');
    }
  }
  assert.ok(driven > 500, `expected many driven hair vertices, got ${driven}`);
  assert.equal(rig.vertexCount, driven);
});

test('Ningguang hair springs drive the visible surface under the head', async () => withFetch(async () => {
  const actor = createNativeCharacter(data, { loadTextures: false });
  try {
    await actor.setAppearance('ningguang');
    assert.equal(actor.secondaryMotionStatus.available, true);
    assert.equal(actor.secondaryMotionStatus.bones, rig.bones.length);
    assert.equal(actor.skeleton.bones.length, 30, 'native skeleton stays 30 bones');

    // The roots hang off the head: each depth-0 spring starts near the skull.
    // Snapshot positions are world-space, so compare them on that frame.
    actor.group.updateMatrixWorld(true);
    const head = new THREE.Vector3();
    actor.bones[13].getWorldPosition(head);
    const roots = rig.bones.map((bone, index) => [bone, index]).filter(([bone]) => bone.parent === 13);
    assert.ok(roots.length >= 6, 'one root per large strand');
    const snapshot = actor.getSecondaryMotionSnapshot();
    for (const [, index] of roots) {
      const distance = vector(snapshot[index].position).distanceTo(head);
      assert.ok(distance < 0.8, `spring root must sit on the skull, got ${distance.toFixed(3)}`);
    }

    const pose = data.poses[144];
    const sample = [];
    for (let frame = 0; frame < 90; frame++) {
      const t = frame / 60;
      actor.group.position.set(Math.sin(t * 2) * .35, Math.max(0, Math.sin(t * 4)) * .45, 0);
      actor.group.rotation.y = Math.sin(t * 3) * .65;
      actor.setPoseFrame(pose.source, pose.start + (t * 30) % (pose.end - pose.start));
      actor.updateSecondaryMotion(1 / 60);
      if (frame % 10 === 0) sample.push(actor.getSecondaryMotionSnapshot().map(node => ({ position: [...node.position], tail: [...node.tail] })));
    }
    assert.ok(sample.length >= 8);
    for (const frame of sample) {
      assert.ok(frame.every(node => node.tail.every(Number.isFinite)), 'springs stay finite');
    }
    // Motion must be actual secondary motion, not a rigid head attachment.
    const moved = sample.slice(1).some((frame, i) => frame.some((node, n) => vector(node.tail).distanceTo(vector(sample[i][n].tail)) > 1e-4));
    assert.equal(moved, true, 'hair must move relative to the previous sample');
    // Every spring keeps a sane world-space length, so nothing explodes or flips.
    for (const frame of sample) {
      for (let n = 0; n < rig.bones.length; n++) {
        const length = vector(frame[n].tail).distanceTo(vector(frame[n].position));
        assert.ok(length > 0.005 && length < 0.6, `spring ${n} length out of range: ${length.toFixed(3)}`);
      }
    }
  } finally {
    actor.dispose();
  }
}));
