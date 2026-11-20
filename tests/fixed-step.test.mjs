import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.js';
import {FixedStepClock, SIMULATION_STEP} from '../dist/fixed-step.js';
import {MeteorGame} from '../dist/engine.js';

test('30/60/144Hz and 100ms stalls produce the same 60 fixed ticks per second',()=>{
  for(const deltas of [Array(30).fill(1/30),Array(60).fill(1/60),Array(144).fill(1/144),Array(10).fill(.1)]){
    const clock=new FixedStepClock(),steps=[];for(const dt of deltas)clock.advance(dt,step=>steps.push(step));
    assert.equal(steps.length,60);assert.ok(steps.every(step=>step===SIMULATION_STEP));assert.ok(clock.accumulator<1e-9);assert.equal(clock.droppedSeconds,0);
  }
});
test('fractional time is retained, invalid deltas ignored, and long suspension is bounded',()=>{
  const clock=new FixedStepClock();let ticks=0;const step=()=>ticks++;
  clock.advance(1/120,step);assert.equal(ticks,0);clock.advance(1/120,step);assert.equal(ticks,1);
  for(const dt of [NaN,Infinity,-1,0])clock.advance(dt,step);assert.equal(ticks,1);
  assert.equal(clock.advance(10,step),15);assert.equal(ticks,16);assert.equal(clock.droppedSeconds,9.75);
  clock.advance(1/60,step);assert.equal(ticks,17,'discarded background time must not leave a catch-up backlog');
});
test('engine world step orders scene, actors, body separation and projectiles with fixed dt',()=>{
  const game=Object.create(MeteorGame.prototype),events=[];
  Object.assign(game,{hero:{},enemies:[{}],elapsed:0,matchElapsed:0,updateAccum:0,running:true,paused:false,
    currentMap:{props:{update:dt=>events.push(['props',dt])},update:dt=>events.push(['map',dt])},missionHost:{update:dt=>events.push(['mission',dt])},
    _updateFighter:(f,dt)=>events.push([f===game.hero?'hero':'enemy',dt]),_separateCharacters:dt=>events.push(['separate',dt]),
    projectiles:{update:dt=>events.push(['projectiles',dt])},wheels:{update:dt=>events.push(['wheels',dt])},_hud(){}});
  game._advanceWorld(.1);assert.ok(Math.abs(game.matchElapsed-.1)<1e-12);
  assert.deepEqual(events.slice(0,8).map(e=>e[0]),['mission','props','map','hero','enemy','separate','projectiles','wheels']);
  assert.equal(events.length,48);assert.ok(events.every(e=>e[1]===SIMULATION_STEP));
});
test('pause/resume discards fractional and paused time; ending a tick can stop catch-up',()=>{
  const game=Object.create(MeteorGame.prototype);let ticks=0,clockReads=0;
  Object.assign(game,{hero:{},keys:new Set(),paused:false,clock:{getDelta(){clockReads++;return 20;}},_hud(){},_stepWorld(){ticks++;}});
  game._advanceWorld(1/120);game.pause(true);game._advanceWorld(20);game.pause(false);
  game._advanceWorld(1/120);assert.equal(ticks,0);game._advanceWorld(1/120);assert.equal(ticks,1);assert.equal(clockReads,2);
  game._stepWorld=()=>{ticks++;game.paused=true;};game._advanceWorld(.1);assert.equal(ticks,2);assert.equal(game.simulationClock.accumulator,0);
});
test('render frame draws once and updates cosmetics once while catching up multiple world ticks',()=>{
  const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>1;
  try{
    const game=Object.create(MeteorGame.prototype);let ticks=0,draws=0,presentation=0,camera=0;
    Object.assign(game,{clock:{getDelta:()=>.1},hero:{},paused:false,_stepWorld(){ticks++;},_updatePresentation(){presentation++;},_tickCamera(){camera++;},renderer:{render(){draws++;}}});
    game._frame();assert.deepEqual({ticks,draws,presentation,camera},{ticks:6,draws:1,presentation:1,camera:1});
  }finally{globalThis.requestAnimationFrame=previous;}
});

test('running poses and camera advance every render frame despite 60 Hz simulation', () => {
  const request = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const schedules = [Array(120).fill(1 / 120), Array(144).fill(1 / 144),
      Array.from({length: 60}, (_, i) => (i % 2 ? 21 : 12) / 1000)];
    for (const schedule of schedules) {
      const root = new THREE.Group(), head = new THREE.Bone(), clothing = new THREE.Bone();
      root.add(head, clothing);
      root.rotation.y = 7;
      const character = {source: 0, frame: 0, bones: [head, clothing], dummies: [],
        refreshRenderPose: () => root.updateMatrixWorld(true)};
      const hero = {root, character, combat: {timeline: {loop: true}, busy: false}};
      const game = Object.create(MeteorGame.prototype), rendered = [];
      let seconds, elapsed = 0, ticks = 0, cameraZ;
      Object.assign(game, {hero, enemies: [], running: true, paused: false, clock: {getDelta: () => seconds},
        _stepWorld(dt) {
          ticks++;
          root.position.z = ticks * dt * 8;
          root.rotation.y = 7 + ticks * dt * .6;
          head.rotation.z = ticks * dt * .4;
          clothing.position.x = ticks * dt * .2;
          character.frame = ticks * dt * 30;
        },
        _updatePresentation() {},
        _tickCamera() { cameraZ = root.position.z; },
        renderer: {render() { rendered.push({z: root.position.z, head: head.rotation.z, cloth: clothing.position.x, cameraZ}); }}
      });
      for (seconds of schedule) {
        elapsed += seconds;
        game._frame(elapsed * 1000);
        assert.equal(root.position.z, ticks * SIMULATION_STEP * 8);
        assert.equal(root.rotation.y, 7 + ticks * SIMULATION_STEP * .6);
        assert.equal(character.frame, ticks * SIMULATION_STEP * 30);
        assert.equal(clothing.position.x, ticks * SIMULATION_STEP * .2);
      }
      for (let i = 3; i < rendered.length; i++) {
        const current = rendered[i], old = rendered[i - 1];
        assert.ok(Math.abs((current.z - old.z) - schedule[i] * 8) < 1e-10);
        assert.ok(Math.abs((current.head - old.head) - schedule[i] * .4) < 1e-10);
        assert.ok(Math.abs((current.cloth - old.cloth) - schedule[i] * .2) < 1e-10);
        assert.equal(current.cameraZ, current.z);
      }
    }
  } finally {
    globalThis.requestAnimationFrame = request;
  }
});

test('rendering a loop seam blends neighboring poses and restores them even if drawing fails', () => {
  const request = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  try {
    const root = new THREE.Group(), coat = new THREE.Bone(), socket = new THREE.Object3D(), hand = new THREE.Bone();
    root.add(coat, hand, socket);
    coat.rotation.x = .2;
    const character = {source: 0, frame: 47, bones: [coat, hand], dummies: [socket],
      refreshRenderPose: () => root.updateMatrixWorld(true)};
    const hero = {root, character, combat: {timeline: {loop: true}, busy: false}};
    const game = Object.create(MeteorGame.prototype);
    let seconds = SIMULATION_STEP * 1.5, shown, drawError = true;
    Object.assign(game, {hero, enemies: [], running: true, clock: {getDelta: () => seconds},
      _stepWorld() { root.position.x += .1; coat.rotation.x = .4; character.frame = 3; hand.add(socket); },
      _updatePresentation() {}, _tickCamera() {},
      renderer: {render() {
        shown = {x: root.position.x, angle: coat.rotation.x};
        assert.equal(socket.parent, hand);
        if (drawError) throw new Error('renderer lost context');
      }}
    });
    assert.throws(() => game._frame(25), /renderer lost context/);
    assert.ok(Math.abs(shown.x - .05) < 1e-9);
    assert.ok(Math.abs(shown.angle - .3) < 1e-9);
    assert.ok(Math.abs(coat.rotation.x - .4) < 1e-9);
    assert.equal(root.position.x, .1);
    assert.equal(character.frame, 3);

    game._resetWorldClock();
    root.position.x = 6;
    drawError = false;
    seconds = SIMULATION_STEP / 2;
    game._frame(50);
    assert.equal(shown.x, 6, 'new scene, pause or visibility reset cannot blend from a stale position');
  } finally {
    globalThis.requestAnimationFrame = request;
  }
});

test('静态菜单不更新世界或提交绘制，返回战斗没有累计补帧',()=>{
  const previous=globalThis.requestAnimationFrame;globalThis.requestAnimationFrame=()=>1;
  try{
    const game=Object.create(MeteorGame.prototype);let draws=0,ticks=0,presentation=0,camera=0,seconds=20;
    Object.assign(game,{menuIdle:true,clock:{getDelta:()=>seconds},simulationClock:new FixedStepClock(),hero:{},paused:false,
      _stepWorld(){ticks++;},_updatePresentation(){presentation++;},_tickCamera(){camera++;},renderer:{render(){draws++;}}});
    game.simulationClock.advance(1/120,()=>ticks++);
    for(let i=0;i<60;i++)game._frame();
    assert.deepEqual({draws,ticks,presentation,camera},{draws:0,ticks:0,presentation:0,camera:0});
    assert.equal(game.simulationClock.accumulator,0);
    game.menuIdle=false;seconds=1/60;game._frame();
    assert.deepEqual({draws,ticks,presentation,camera},{draws:1,ticks:1,presentation:1,camera:1});
  }finally{globalThis.requestAnimationFrame=previous;}
});
