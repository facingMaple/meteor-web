import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The .blend conversion left two surfaces on the wrong bones:
//   新規 (12): a shoulder-to-calf side drape, bound 100% to the head.
//   裙   (28): skirt panels partly bound to finger / upper-arm bones.
// These checks pin the repaired bindings so a future rebuild cannot regress them.
const skin = JSON.parse(await readFile(new URL('../dist/assets/enhanced/ningguang/mesh.json', import.meta.url)));
const manifest = JSON.parse(await readFile(new URL('../dist/assets/enhanced/ningguang/manifest.json', import.meta.url)));

const HEAD = 13;
const ARM_BONES = new Set([15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
const TORSO_BONES = new Set([1, 2, 11]);          // pelvis, spine, spine1
const vectors = material => {
  const set = new Set();
  for (const face of skin.faces) if (face.material === material) for (const index of face.indices) set.add(index);
  return set;
};
const weightsOf = index => {
  const indices = skin.skinIndices.slice(index * 4, index * 4 + 4);
  const weights = skin.skinWeights.slice(index * 4, index * 4 + 4);
  return indices.map((bone, slot) => [bone, weights[slot]]).filter(([, weight]) => weight > 0);
};

test('Every vertex weight row stays normalized after the repair', () => {
  let bad = 0;
  for (let v = 0; v < skin.vertexCount; v++) {
    const sum = [0, 1, 2, 3].reduce((total, k) => total + skin.skinWeights[v * 4 + k], 0);
    if (Math.abs(sum - 1) > 1e-3) bad++;
  }
  assert.equal(bad, 0, `${bad} vertices do not sum to 1`);
});

test('The 新規 side drapes no longer ride the head bone', () => {
  const vertices = vectors(12);
  assert.ok(vertices.size > 1000);
  const onHead = [...vertices].filter(index => weightsOf(index).some(([bone]) => bone === HEAD));
  assert.deepEqual(onHead, [], 'a head turn must not drag the drapes');
  // They must follow the torso chain instead.
  for (const index of vertices) {
    const bones = weightsOf(index).map(([bone]) => bone);
    assert.ok(bones.every(bone => TORSO_BONES.has(bone) || bone === 14 || bone === 22 || bone === 3 || bone === 7 || bone >= 30 || bone === 12),
      `vertex ${index} left the body chain: ${bones}`);
  }
  // Both shoulders are represented, so the drape is not pinned to one side.
  const sides = new Set();
  for (const index of vertices) {
    const x = skin.positions[index * 3];
    if (weightsOf(index).some(([bone]) => bone === (x >= 0 ? 14 : 22))) sides.add(x >= 0 ? 'l' : 'r');
  }
  assert.deepEqual([...sides].sort(), ['l', 'r']);
});

test('The skirt follows pelvis/thigh instead of hands or arms', () => {
  const vertices = vectors(28);
  assert.ok(vertices.size > 1000);
  const onArms = [...vertices].filter(index => weightsOf(index).some(([bone]) => ARM_BONES.has(bone)));
  assert.deepEqual(onArms, [], 'skirt panels must not be dragged by hand or arm bones');
  const thighWeight = [...vertices].reduce((total, index) => {
    const weights = weightsOf(index);
    return total + weights.filter(([bone]) => bone === 3 || bone === 7).reduce((sum, [, weight]) => sum + weight, 0);
  }, 0);
  assert.ok(thighWeight > 0, 'the skirt must bend with the legs');
});

test('The repair is documented in the shipped manifest', () => {
  assert.match(manifest.provenance.skinRepair ?? '', /drape/i);
  const limits = manifest.provenance.limits ?? [];
  assert.ok(limits.some(line => /side drapes/i.test(line)));
  assert.ok(limits.some(line => /Web spring rig/i.test(line)));
});
