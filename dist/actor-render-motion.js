import * as THREE from './vendor/three.module.js';

// Keep the last two simulation poses available for drawing between ticks.
// Animation clocks and the local transforms used by gameplay stay authoritative.
const MAX_CONTINUOUS_DISTANCE_SQ = 1.5 ** 2;
const interpolateLoop = actor => actor.combat?.timeline?.loop && !actor.combat.busy &&
  !actor.combat.poseBlend && !actor.dead && actor.character?.refreshRenderPose;

function trackJoint(node) {
  return {
    node, parent: null,
    previousPosition: new THREE.Vector3(), previousRotation: new THREE.Quaternion(),
    currentPosition: new THREE.Vector3(), currentRotation: new THREE.Quaternion()
  };
}

export class ActorRenderMotion {
  constructor() {
    this.samples = new WeakMap();
    this.applied = [];
  }

  reset() { this.samples = new WeakMap(); }

  forget(actor) { this.samples.delete(actor); }

  capture(actor) {
    if (!actor?.root || actor.disposed || actor.scriptRemoved) return;
    let sample = this.samples.get(actor);
    if (!sample || sample.character !== actor.character) {
      sample = {
        actor, character: actor.character,
        previousPosition: new THREE.Vector3(), currentPosition: new THREE.Vector3(),
        joints: null
      };
      this.samples.set(actor, sample);
    }
    sample.previousPosition.copy(actor.root.position);
    sample.previousYaw = actor.root.rotation.y;
    sample.dead = actor.dead;
    sample.timeline = null;
    if (!interpolateLoop(actor)) return;

    const character = actor.character;
    sample.timeline = actor.combat.timeline;
    sample.source = character.source;
    sample.frame = character.frame;
    sample.joints ??= [...character.bones, ...character.dummies].map(trackJoint);
    for (const joint of sample.joints) {
      joint.parent = joint.node.parent;
      joint.previousPosition.copy(joint.node.position);
      joint.previousRotation.copy(joint.node.quaternion);
    }
  }

  apply(actors, weight) {
    for (const actor of actors) {
      const sample = this.samples.get(actor);
      if (!sample || actor.disposed || actor.scriptRemoved || actor.dead !== sample.dead ||
          actor.character !== sample.character) continue;
      const { root, character } = actor;
      const distanceSq = root.position.distanceToSquared(sample.previousPosition);
      if (distanceSq > MAX_CONTINUOUS_DISTANCE_SQ) continue;
      const turn = root.rotation.y - sample.previousYaw;
      const yawDelta = Math.atan2(Math.sin(turn), Math.cos(turn));
      const poseChanged = sample.timeline && sample.timeline === actor.combat.timeline &&
        interpolateLoop(actor) && sample.source === character.source && sample.frame !== character.frame;
      if (!poseChanged && distanceSq < 1e-12 && Math.abs(yawDelta) < 1e-6) continue;

      sample.currentPosition.copy(root.position);
      sample.currentYaw = root.rotation.y;
      sample.poseChanged = poseChanged;
      this.applied.push(sample);
      root.position.lerpVectors(sample.previousPosition, sample.currentPosition, weight);
      root.rotation.y = sample.currentYaw - yawDelta * (1 - weight);
      if (poseChanged) {
        // Blend local transforms through loop wraparound. Interpolating frame
        // numbers there would go backward through the entire animation.
        for (const joint of sample.joints) {
          const { node } = joint;
          joint.currentPosition.copy(node.position);
          joint.currentRotation.copy(node.quaternion);
          if (joint.parent !== node.parent) continue;
          node.position.lerpVectors(joint.previousPosition, joint.currentPosition, weight);
          node.quaternion.slerp(joint.previousRotation, 1 - weight);
        }
        character.refreshRenderPose();
      } else root.updateMatrixWorld(true);
    }
  }

  restore() {
    for (const sample of this.applied) {
      const { actor, character } = sample;
      actor.root.position.copy(sample.currentPosition);
      actor.root.rotation.y = sample.currentYaw;
      if (sample.poseChanged) {
        for (const joint of sample.joints) {
          joint.node.position.copy(joint.currentPosition);
          joint.node.quaternion.copy(joint.currentRotation);
        }
        character.refreshRenderPose();
      } else actor.root.updateMatrixWorld(true);
    }
    this.applied.length = 0;
  }
}
