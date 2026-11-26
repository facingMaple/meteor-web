import test from 'node:test';
import assert from 'node:assert/strict';
import {Group,Vector3} from '../dist/vendor/three.module.js';
import {MeteorGame} from '../dist/engine.js';
import {NetworkLocalMovement} from '../dist/network-local-movement.js';
import {NATIVE_WEAPONS} from '../dist/native-combat.js';

function fixture(){
  const strike=NATIVE_WEAPONS.sword.basic[0];
  const pose=(id,attacks=[])=>({id,source:0,start:0,end:60,loopStart:1,loopEnd:59,phases:[],drags:[],cancels:[],valid:true,attacks});
  const poses=new Map([6,144,145,146,147,148,149,NATIVE_WEAPONS.sword.guard,strike].map(id=>[id,pose(id,id===strike?[{start:5,end:20}]:[])]));
  const game=Object.create(MeteorGame.prototype);
  const actor={root:new Group(),weapon:'sword',grounded:true,hp:1000,combat:{stance:6,data:{poses}},
    character:{source:0,frame:0,setPoseFrame(source,frame){Object.assign(this,{source,frame});}}};
  Object.assign(game,{hero:actor,cameraAngle:0,hostPhysics:{speed:8,step:.55,gravity:70.56},_horizontalBlocked:(p,x,z)=>p.z+z<-.85,
    _footSupport:p=>p.x<=1?{point:new Vector3()}:null});
  const owner=new NetworkLocalMovement(game);
  const state={grounded:true,position:[0,0,0],moveTime:0,moveScale:1,frame:0,pose:6};
  return {owner,actor,game,state,strike};
}

test('客人在首个渲染帧前进，摄像机转向与松键无需等待回包，模拟位置保持权威值',()=>{
  const {owner,actor,game,state}=fixture();
  owner.receive(state,0);owner.input('forward',true,1,0);
  owner.update(1/144,1/144);
  assert.ok(actor.root.position.z<-.01);
  owner.restore();assert.deepEqual(actor.root.position.toArray(),[0,0,0]);
  game.cameraAngle=-Math.PI/2;owner.update(1/144,2/144);
  assert.ok(actor.root.position.x>.01);
  owner.restore();owner.input('forward',false,2,2/144);
  owner.update(1/144,3/144);const stopped=actor.root.position.clone();owner.restore();
  owner.update(1/144,4/144);assert.equal(actor.root.position.x,stopped.x);
});

test('带 90 ms 延迟、抖动与丢包的权威快照纠偏有界，移动使用地形阻挡与蹲行速度',()=>{
  const {owner,actor,game,state}=fixture();
  game._horizontalBlocked=()=>false;game._footSupport=()=>({point:new Vector3()});
  owner.receive(state,0);owner.input('forward',true,1,0);
  const control={cameraAngle:0,keys:new Set(['forward'])};
  const speed=new Vector3();game._predictGroundMovement(speed,control,144,1,1);
  let last=0,maxForward=0;
  for(let i=1;i<=144;i++){
    const now=i/144;
    if(i%5===0&&i%35!==0&&now>.10){
      const moveTime=now-.09-[0,.014,-.008][i%3];
      owner.receive({...state,pose:144,moveTime,position:[0,.03,Math.max(0,moveTime-.045)*speed.z]},now);
    }
    owner.update(1/144,now);
    maxForward=Math.max(maxForward,last-actor.root.position.z);
    last=actor.root.position.z;owner.restore();
  }
  assert.ok(last<speed.z*.88&&last>speed.z*1.1,`display ${last} vs ${speed.z}`);
  assert.ok(maxForward<Math.abs(speed.z)/144*2.5,`largest step ${maxForward}`);
  const normal=new Vector3(),crouch=new Vector3();
  game._predictGroundMovement(normal,control,144,1,.1);game._predictGroundMovement(crouch,control,145,1,.1);
  assert.ok(Math.abs(crouch.z)<Math.abs(normal.z));
  game._horizontalBlocked=(p,x,z)=>p.z+z<-.05;
  game._predictGroundMovement(crouch.set(0,0,0),control,145,1,.1);
  assert.equal(crouch.z,0);
  game._horizontalBlocked=()=>false;game._footSupport=()=>null;
  game._predictGroundMovement(crouch,control,145,1,.1);assert.equal(crouch.z,0);
});

test('普通攻击即时抬手，动画止于打击帧之前，房主拒绝或受击时结束预览',()=>{
  const {owner,actor,game,state,strike}=fixture();
  game._selectPlayerAttack=()=>({poseId:strike,rage:0});
  owner.receive(state,0);owner.reconcile(0);owner.input('attack',true,1,0);
  owner.presentAttack(1/60,1/60);
  assert.ok(actor.character.frame>0&&actor.character.frame<5);assert.equal(actor.hp,1000);
  for(let i=2;i<12;i++)owner.presentAttack(1/60,i/60);
  assert.ok(actor.character.frame<5);
  actor.networkInputAck=1;owner.presentAttack(1/60,.21);assert.equal(owner.attack,null);
  owner.input('attack',true,2,.22);assert.ok(owner.attack);
  actor.networkReactionPhase='hit';owner.presentAttack(1/60,.24);assert.equal(owner.attack,null);
});

test('已腾空的客人在下一帧改变空中方向，保留权威高度，遇到特殊位移交还房主',()=>{
  const {owner,actor,game,state}=fixture();
  actor.root.position.y=2;actor.grounded=false;
  owner.receive({...state,grounded:false,freeAir:true,position:[0,2,0],moveVelocity:[0,2,-1]},0);
  game.cameraAngle=-Math.PI/2;owner.input('forward',true,1,0);
  owner.update(1/60,1/60);
  assert.ok(actor.root.position.x>0);
  assert.ok(actor.root.position.z<0,'新方向保留之前的空中惯性');
  assert.equal(actor.root.position.y,2);
  owner.restore();
  owner.receive({...state,grounded:false,freeAir:false,actionBusy:true,position:[0,2,0]},.03);
  owner.update(1/60,.033);
  assert.deepEqual(actor.root.position.toArray(),[0,2,0]);
});

test('房主模拟冻结后即使仍有网络包，本机也只做有界预测',()=>{
  const {owner,actor,state,game}=fixture();
  game._horizontalBlocked=()=>false;game._footSupport=()=>({point:new Vector3()});
  owner.receive(state,0,10);owner.input('forward',true,1,0);
  let afterFreeze;
  for(let i=1;i<=60;i++){
    const now=i/60;
    if(i%3===0)owner.receive(state,now,10);
    owner.update(1/60,now);
    if(i===24)afterFreeze=actor.root.position.z;
    owner.restore();
  }
  owner.update(1/60,1.02);
  assert.ok(actor.root.position.z>=afterFreeze-.02,'冻结后的快照不能让预测继续走向远处');
  assert.equal(owner.receivedAt,0);
});
