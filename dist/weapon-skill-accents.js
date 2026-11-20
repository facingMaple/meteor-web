import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
const LIMIT = 16;
const CUES = {
  368: [[3, 'gather', .58], [18, 'feathers', .61]],
  369: [[1, 'crescent', .49], [8, 'feathers', .43]],
  560: [[11, 'cutLeft', .29], [23, 'cutRight', .32]],
  561: [[3, 'gather', .28], [11, 'orbit', .24], [18, 'orbit', .24], [25, 'crescent', .4]],
  562: [[14, 'rise', .55]],
  563: [[18, 'shock', .46]],
  571: [[10, 'gather', .29], [19, 'pierce', .37], [23, 'spiralJet', .33]],
  293: [[7, 'rise', .59], [35, 'rise', .57], [66, 'rise', .56]],
  294: [[7, 'pierce', .48]],
  566: [[26, 'fissure', .27], [30, 'sparks', .30], [34, 'fissure', .40]],
};
const PALETTES = {
  sword:   [0xfbd1a0, 0xff784f],
  raiden:  [0xe7d6ff, 0xac60eb],
  spear:   [0xbbf5ed, 0x55c4be],
  hammer:  [0xffde96, 0xff942d],
};

function path(kind, lane, t) {
  const taper = Math.sin(Math.PI * t) ** .64;
  if (kind === 'gather') {
    const angle = lane * TAU / 5 + t * .78, radius = .62 + t * .61;
    return [Math.sin(angle) * radius, .88 + t * .98 + .1 * Math.cos(lane), Math.cos(angle) * radius, taper * .095];
  }
  if (kind === 'feathers') {
    const spread = lane - 3, fan = .36 + t * 1.83;
    return [spread * fan * .43, .78 + (1.45 - Math.abs(spread) * .24) * t,
      .36 + fan * (1.12 - Math.abs(spread) * .16), taper * (.20 - Math.abs(spread) * .024)];
  }
  if (kind === 'pierce') {
    const angle = lane * TAU / 5 + 1, spread = (.10 + t * .78) * (lane % 2 ? 1 : .72);
    return [Math.cos(angle) * spread, 1.04 + Math.sin(angle) * spread, 2.75 - t * (2.05 + .21 * Math.sin(lane * 2)), taper * .07];
  }
  if (kind === 'spiralJet') {
    const angle = lane * Math.PI + t * TAU * 1.12, radius = .58 - .45 * t;
    return [Math.cos(angle) * radius, 1.06 + Math.sin(angle) * radius, .72 + 2.25 * t, taper * .10];
  }
  if (kind === 'fissure') {
    const angle = lane * TAU / 9 + Math.sin(t * 18 + lane) * .09, radius = .74 + t * (1.15 + .25 * Math.cos(lane * 7));
    return [Math.cos(angle) * radius, .12 + (lane % 3) * .03 + taper * .08, Math.sin(angle) * radius, taper * .090];
  }
  if (kind === 'sparks') {
    const angle = lane * 2.39996, radius = .68 + t * (.68 + (lane % 3) * .24);
    return [Math.cos(angle) * radius, .18 + t * (.58 + (lane % 4) * .19), Math.sin(angle) * radius, taper * .055];
  }
  if (kind === 'shock' || kind === 'rise') {
    const rising = kind === 'rise', angle = lane * TAU / 3 + t * (rising ? 3.05 : 1.80);
    const radius = rising ? .86 + t * .60 : 1.21 + t * .38;
    return [Math.sin(angle) * radius, rising ? .25 + t * 1.64 + lane * .17 : .17 + lane * .04 + taper * .12, Math.cos(angle) * radius, taper * (rising ? .17 : .10)];
  }
  const tilted = kind === 'cutLeft' || kind === 'cutRight', sign = kind === 'cutRight' ? -1 : 1;
  const arc = kind === 'orbit' ? 3.1 : 2.27, angle = (t - .5) * arc + lane * .22;
  const radius = 1.35 + lane * .37 + .53 * taper;
  const height = .98 + lane * .18 + (tilted ? (t - .5) * 1.7 * sign : .20 * taper);
  return [Math.sin(angle) * radius, height, Math.cos(angle) * radius - .45, taper * (lane === 0 ? .34 : .13)];
}

function geometryFor(kind) {
  const positions = [], uvs = [], indices = [], steps = 22;
  const axial = kind === 'pierce' || kind === 'spiralJet' || kind === 'feathers';
  const lanes = { gather: 5, feathers: 7, pierce: 5, rise: 3, shock: 3, fissure: 9, sparks: 10 }[kind] ?? 2;
  for (let lane = 0; lane < lanes; lane++) {
    for (let step = 0; step <= steps; step++) {
      const t = step / steps, [x, y, z, width] = path(kind, lane, t);
      const radius = Math.hypot(x, z) || 1;
      for (const side of [-1, 1]) {
        const radial = width * side;
        positions.push(x + radial * (axial ? 1 : kind === 'fissure' ? -z / radius : x / radius),
          y + radial * (axial ? .57 : kind === 'fissure' ? 0 : .34),
          z + radial * (axial ? 0 : kind === 'fissure' ? x / radius : z / radius));
        uvs.push(side === -1 ? 0 : 1, t);
      }
      if (step) {
        const next = (lane * (steps + 1) + step) * 2;
        indices.push(next - 2, next - 1, next, next, next - 1, next + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function accentMaterial([edge, ink]) {
  return new THREE.ShaderMaterial({ uniforms: { edge: { value: new THREE.Color(edge) }, ink: { value: new THREE.Color(ink) }, strength: { value: 0 } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, toneMapped: false,
    vertexShader: `varying vec2 ribbonUv;
      void main() { ribbonUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 edge, ink; uniform float strength; varying vec2 ribbonUv;
      void main() {
        float transverse = ribbonUv.x; float along = ribbonUv.y;
        float rim = exp(-abs(transverse - 0.78) * 24.0);
        float rib = pow(0.5 + 0.5 * cos(along * 39.0 - transverse * 14.0), 4.0);
        float body = sin(transverse * 3.14159265) * (0.22 + 0.26 * rib);
        float taper = smoothstep(0.0, 0.15, along) * (1.0 - smoothstep(0.82, 1.0, along));
        gl_FragColor = vec4(mix(ink, edge, rim), strength * taper * (rim * 0.80 + body));
        #include <colorspace_fragment>
      }` });
}

export class WeaponSkillAccents {
  constructor(scene) {
    this.scene = scene; this.time = 0; this.active = []; this.casts = new WeakMap(); this.geometries = new Map();
  }
  hasCue(state) { return !state.blend && !!CUES[state.pose?.id]; }
  sample(actor, state, offset) {
    if (!this.hasCue(state) || !state.frameIntervals?.length || !actor.root?.getWorldPosition) return;
    const previous = this.casts.get(actor), pose = state.pose;
    const cast = previous?.serial === state.serial && previous.poseId === pose.id ? previous : { serial: state.serial, poseId: pose.id, fired: new Set() };
    this.casts.set(actor, cast);
    for (const [frame, kind, lifetime] of CUES[pose.id]) {
      if (cast.fired.has(frame)) continue;
      const at = pose.start + frame, interval = state.frameIntervals.find(range => range.from <= at && range.to >= at && range.to > range.from);
      if (!interval) continue;
      cast.fired.add(frame);
      const time = THREE.MathUtils.lerp(interval.timeFrom, interval.timeTo, (at - interval.from) / (interval.to - interval.from));
      this._add(actor, kind, lifetime, this.time + offset + time);
    }
  }
  _add(actor, kind, lifetime, start) {
    while (this.active.length >= LIMIT) this._remove(this.active[0]);
    if (!this.geometries.has(kind)) this.geometries.set(kind, geometryFor(kind));
    const palette = actor.weapon === 'sword' && (actor.weaponAppearance === 'raiden' || actor.raidenSword?.visible)
      ? PALETTES.raiden : PALETTES[actor.weapon] || PALETTES.sword;
    const mesh = new THREE.Mesh(this.geometries.get(kind), accentMaterial(palette));
    mesh.name = `兵器招式点缀 · ${kind}`;
    mesh.rotation.y = actor.root.rotation.y; mesh.visible = false; mesh.renderOrder = 2;
    actor.root.getWorldPosition(mesh.position);
    if (kind === 'fissure' || kind === 'sparks') {
      mesh.position.x += Math.sin(mesh.rotation.y) * .7;
      mesh.position.z += Math.cos(mesh.rotation.y) * .7;
    }
    this.scene.add(mesh);
    this.active.push({ actor, mesh, kind, lifetime, start, yaw: mesh.rotation.y });
  }
  update(dt) {
    this.time += dt;
    for (let index = this.active.length - 1; index >= 0; index--) {
      const cue = this.active[index], { actor, mesh, kind } = cue;
      const age = (this.time - cue.start) / cue.lifetime;
      if (age >= 1 || actor.dead || actor.disposed || actor.scriptRemoved || actor.combat?.reacting || actor.networkReactionPhase) { this._remove(cue); continue; }
      if (age < 0) continue;
      mesh.visible = true;
      const travel = 1 - (1 - age) ** 2, gather = kind === 'gather', vertical = kind === 'rise' || kind === 'feathers' || kind === 'sparks';
      const expands = kind === 'shock' || kind === 'fissure';
      const horizontal = gather ? 1.18 - .64 * travel : expands ? .68 + .95 * travel : .82 + .38 * travel;
      const depth = kind === 'spiralJet' ? .76 + .48 * travel : kind === 'pierce' ? .80 + .34 * travel : horizontal;
      mesh.scale.set(horizontal, vertical ? .73 + .46 * travel : 1, depth);
      mesh.rotation.y = cue.yaw + (gather ? .45 : kind === 'rise' ? .85 : kind === 'orbit' ? .65 : 0) * travel;
      mesh.material.uniforms.strength.value = Math.min(1, (age + .015) / .13) * (1 - age) ** 1.2 * (gather ? .70 : .97);
    }
  }
  _remove(cue) {
    this.active.splice(this.active.indexOf(cue), 1); cue.mesh.removeFromParent(); cue.mesh.material.dispose();
  }
  clearActor(actor) {
    for (const cue of [...this.active]) if (cue.actor === actor) this._remove(cue);
    this.casts.delete(actor);
  }
  clear() { for (const cue of [...this.active]) this._remove(cue); this.casts = new WeakMap(); }
  dispose() { this.clear(); for (const geometry of this.geometries.values()) geometry.dispose(); this.geometries.clear(); }
}
