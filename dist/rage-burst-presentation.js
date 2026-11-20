import * as THREE from './vendor/three.module.js';

const up = new THREE.Vector3(0, 1, 0);
const smooth = t => THREE.MathUtils.smoothstep(t, 0, 1);

// Web choreography. Use the shoulder axes so the gesture works in any stance.
export function applyRageBurstPose(findBone, progress) {
  const coil = smooth(progress / .13);
  const release = smooth((progress - .13) / .17);
  const settle = smooth((progress - .48) / .52);
  const weight = coil * (1 - settle);
  if (!weight) return null;
  const left = findBone('bau_L_UpperArm'), right = findBone('bau_R_UpperArm');
  if (!left || !right) return null;
  const lateral = left.getWorldPosition(new THREE.Vector3()).sub(right.getWorldPosition(new THREE.Vector3()));
  lateral.y = 0;
  if (lateral.lengthSq() < 1e-8) return null;
  lateral.normalize();
  const forward = new THREE.Vector3().crossVectors(lateral, up);
  const lerp = THREE.MathUtils.lerp;
  const restore = [];
  const parentRotation = new THREE.Quaternion(), delta = new THREE.Quaternion();
  const parentSpace = (bone, direction) =>
    direction.applyQuaternion(bone.parent.getWorldQuaternion(parentRotation).invert());
  // Source-proportions rigs inherit translation only from the animation root.
  const root = findBone('b');
  let rootPosition;
  if (root?.parent) {
    rootPosition = root.position.clone();
    const height = lerp(-.09, .18, release) * weight;
    const raised = root.getWorldPosition(new THREE.Vector3()).addScaledVector(up, height);
    root.position.copy(root.parent.worldToLocal(raised));
  }
  const spine = findBone('bau_Spine1');
  if (spine?.parent) {
    restore.push([spine, spine.quaternion.clone()]);
    const lean = lerp(.42, -.21, release) * weight;
    spine.quaternion.premultiply(delta.setFromAxisAngle(parentSpace(spine, lateral.clone()), lean));
  }
  const aim = (bone, child, direction) => {
    if (!bone?.parent || child?.parent !== bone || child.position.lengthSq() < 1e-8) return;
    const original = bone.quaternion.clone();
    restore.push([bone, original]);
    const current = child.position.clone().normalize().applyQuaternion(original);
    const desired = parentSpace(bone, direction.normalize());
    bone.quaternion.slerp(delta.setFromUnitVectors(current, desired).multiply(original), weight);
  };
  for (const [name, arm, side, lift] of [['L', left, 1, .43], ['R', right, -1, -.16]]) {
    const elbow = findBone(`bau_${name}_Forearm`), hand = findBone(`bau_${name}_Hand`);
    aim(arm, elbow, lateral.clone().multiplyScalar(side * lerp(.33, .81, release))
      .addScaledVector(forward, lerp(.18, -.28, release)).addScaledVector(up, lerp(-.89, lift, release)));
    aim(elbow, hand, lateral.clone().multiplyScalar(side * lerp(-.56, .48, release))
      .addScaledVector(forward, lerp(.78, .54, release)).addScaledVector(up, lerp(.38, lift + .16, release)));
  }
  return () => {
    if (rootPosition) root.position.copy(rootPosition);
    for (const [bone, rotation] of restore) bone.quaternion.copy(rotation);
  };
}

export function createRageBurstPulse(point) {
  const progress = { value: 0 };
  const group = new THREE.Group();
  group.position.copy(point);

  const wake = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true), new THREE.ShaderMaterial({
    uniforms: { progress },
    transparent: true, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    vertexShader: `
      varying vec2 field;
      void main() {
        field = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float progress;
      varying vec2 field;
      void main() {
        float angle = field.x * 6.283185;
        float billow = sin(angle * 5.0 + progress * 6.0) * 0.07
                     + cos(angle * 9.0 - progress * 4.0) * 0.03;
        float edge = abs(field.y - 0.48 - billow);
        float body = 1.0 - smoothstep(0.025, 0.38, edge);
        float core = 1.0 - smoothstep(0.02, 0.14, edge);
        float ripple = 0.8 + 0.2 * sin(angle * 7.0 + field.y * 5.0);
        float opacity = (body * 0.36 + core * 0.59) * ripple
                      * smoothstep(0.0, 0.10, progress)
                      * (1.0 - smoothstep(0.40, 0.97, progress));
        vec3 tint = mix(vec3(0.59, 0.004, 0.018), vec3(1.0, 0.063, 0.028), core);
        gl_FragColor = vec4(tint, opacity);
        #include <colorspace_fragment>
      }
    `
  }));
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { progress },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      uniform float progress;
      varying vec2 field;
      void main() {
        field = position.xy;
        vec4 center = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        center.xy += position.xy * mix(0.45, 1.35, progress);
        gl_Position = projectionMatrix * center;
      }
    `,
    fragmentShader: `
      uniform float progress;
      varying vec2 field;
      void main() {
        float radius = length(field * vec2(1.0, 0.84));
        float light = (1.0 - smoothstep(0.02, 0.81, radius))
                    * (1.0 - smoothstep(0.16, 0.48, progress));
        gl_FragColor = vec4(1.0, 0.12, 0.055, light * 0.62);
        #include <colorspace_fragment>
      }
    `
  }));
  // The flash's shader expands it in view space.
  flash.frustumCulled = false;
  group.add(wake, flash);

  function update(t) {
    progress.value = t;
    const radius = THREE.MathUtils.lerp(.5, 3.8, 1 - (1 - t) ** 3);
    wake.scale.set(radius, THREE.MathUtils.lerp(.78, 1.35, smooth(t / .42)), radius);
    flash.position.y = THREE.MathUtils.lerp(.28, .66, smooth(t / .34));
  }
  update(0);
  return {
    group, update,
    dispose() {
      group.removeFromParent();
      wake.geometry.dispose();
      wake.material.dispose();
      flash.geometry.dispose();
      flash.material.dispose();
    }
  };
}

const sounds = new WeakMap();
const soundDuration = .32;

export function playRageBurstSound(audio, output, age = 0) {
  if (!audio || !output || audio.state === 'closed' || age >= soundDuration) return false;
  let buffer = sounds.get(audio);
  if (!buffer) {
    const rate = audio.sampleRate;
    buffer = audio.createBuffer(1, Math.ceil(rate * soundDuration), rate);
    const samples = buffer.getChannelData(0);
    let seed = 524389, filtered = 0, low = 0;
    for (let i = 0; i < samples.length; i++) {
      const t = i / rate;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const noise = seed / 2147483648 - 1;
      filtered += .16 * (noise - filtered);
      low += .038 * (noise - low);
      const phase = 2 * Math.PI * (48 * t + 8 * (1 - Math.exp(-12 * t)));
      const thump = .68 * Math.sin(phase) * Math.exp(-14 * t);
      const wind = .95 * (filtered - low) * Math.exp(-6 * t);
      const envelope = Math.min(1, t / .008) * (1 - t / soundDuration) ** 2;
      samples[i] = (thump + wind) * envelope;
    }
    sounds.set(audio, buffer);
  }
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(output);
  source.onended = () => source.disconnect();
  source.start(0, age);
  return true;
}
