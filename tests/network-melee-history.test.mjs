import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from '../dist/vendor/three.module.js';
import {NetworkMeleeHistory} from '../dist/network-melee-history.js';

test('每段连招按自己的输入时差回查，目标随命中窗口前进',()=>{
  const history=new NetworkMeleeHistory(),attacker={grounded:true},target={root:{position:new Vector3()}};
  for(let i=0;i<15;i++){
    target.root.position.x=i/10;
    history.capture(1+i/60,[target]);
  }
  history.begin(attacker,12,.10);
  const first=history.positionAtStrike(attacker,target,12,1.175);
  assert.ok(Math.abs(first.x-.45)<1e-9);
  history.begin(attacker,13,.05);
  assert.equal(history.positionAtStrike(attacker,target,12,1.2),null);
  const second=history.positionAtStrike(attacker,target,13,1.2);
  assert.ok(Math.abs(second.x-.9)<1e-9);
  assert.ok(Math.abs(target.root.position.x-1.4)<1e-9,'回查不能移动当前目标');
});

test('未来时间、过期时差、死亡复活和瞬移不能借回查命中',()=>{
  const history=new NetworkMeleeHistory(),attacker={grounded:true},target={root:{position:new Vector3()}};
  assert.equal(history.delay(1,1.01),0);
  assert.equal(history.delay(1,.7),.25);
  assert.equal(history.delay(1,.6),0);
  assert.equal(history.delay(1,null),0);
  history.capture(1,[target]);
  history.begin(attacker,1,.10);
  target.root.position.x=4;
  assert.equal(history.positionAtStrike(attacker,target,1,1.1),null);
  history.capture(1.1,[target]);
  assert.equal(history.positionAtStrike(attacker,target,1,1.11),null);
  target.dead=true;history.capture(1.12,[target]);
  target.dead=false;history.capture(1.13,[target]);
  assert.equal(history.positionAtStrike(attacker,target,1,1.2),null);
});
