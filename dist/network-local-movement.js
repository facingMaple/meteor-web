import {FixedStepClock} from './fixed-step.js';
import {NativePoseTimeline,NATIVE_WEAPONS} from './native-combat.js';
import {recordNativeDirection} from './native-input.js';
import {nativeStrideSpeed} from './native-movement-profile.js';

const directions=['forward','back','left','right'];
const movementKeys=new Set([...directions,'guard','crouch']);
const HISTORY_SECONDS=.25;
const CORRECTION_SECONDS=.10;
const SNAP_DISTANCE=1.5;
const commandDirections={forward:'up',back:'down',left:'left',right:'right'};

export class NetworkLocalMovement {
  constructor(game){
    this.game=game;
    this.actor=game.hero;
    this.keys=new Set();
    this.clock=new FixedStepClock();
    const position=this.actor.root.position;
    this.position=position.clone();
    this.renderPosition=position.clone();
    this.offset=position.clone().set(0,0,0);
    this.velocity=this.offset.clone();
    this.renderVelocity=this.velocity.clone();
    this.history=[];
    this.control={keys:this.keys,directionBuffer:[],lookLocked:true,cameraAngle:0};
  }
  input(action,down,sequence,time){
    if(action==='clear'){this.clear();return;}
    const actor=this.actor;
    if(down&&action==='guard')this.attack=null;
    if(down&&action==='attack'){
      if(this.attack||!this.canMove(this.anchor)||actor.combat.busy||this.keys.has('guard')||this.keys.has('crouch')||actor.weapon==='musket')return;
      const move=this.game._selectPlayerAttack?.(actor,this.control,{time});
      const weapon=NATIVE_WEAPONS[actor.weapon];
      if(!weapon||move&&(move.pending||move.rage||move.switchesWeapon||move.weaponMode&&move.weaponMode!==actor.combat.weaponMode))return;
      const pose=actor.combat.data.poses.get(move?.poseId??(weapon.modes?.[actor.combat.weaponMode]?.basic||weapon.basic)[0]);
      if(!pose?.valid||!pose.attacks.length)return;
      this.attack={sequence,time,pose,timeline:new NativePoseTimeline(pose,{frameTable:actor.combat.data.frameTable}),from:actor.character.capturePose?.(),
        stop:Math.max(pose.entryFrame??pose.start,Math.min(...pose.attacks.map(window=>window.start))-0.01)};
      this.attack.timeline.frame=pose.entryFrame??pose.start;
      this.control.directionBuffer=[];
      this.dirtyInput=true;
      return;
    }
    if(!movementKeys.has(action))return;
    if(down&&commandDirections[action]&&!this.keys.has(action))this.control.directionBuffer=recordNativeDirection(this.control.directionBuffer,commandDirections[action],time,!actor.grounded);
    if(down!==this.keys.has(action))this.dirtyInput=true;
    if(down)this.keys.add(action);else this.keys.delete(action);
  }
  clear(){
    this.restore();this.keys.clear();this.history.length=0;this.clock.reset();
    this.anchor=null;this.pending=null;this.lastDisplayed=null;this.timeline=null;this.attack=null;this.correction=0;this.control.directionBuffer=[];this.lastStep=null;this.hostTime=undefined;
    this.offset.set(0,0,0);
  }
  restore(){
    if(!this.basePosition)return;
    this.actor.root.position.copy(this.basePosition);
    this.actor.root.rotation.y=this.baseAngle;
    this.basePosition=null;
  }
  receive(state,time,hostTime){
    this.pending={state,time,hostTime};
  }
  get isMoving(){
    return this.keys.has('forward')!==this.keys.has('back')||this.keys.has('left')!==this.keys.has('right');
  }
  canMove(state){
    return state?.grounded&&!state.dead&&!state.actionBusy&&!state.reactionPhase&&!state.musketAim;
  }
  canSteer(state){return state?.freeAir&&Array.isArray(state.moveVelocity)&&!state.dead&&!state.actionBusy&&!state.reactionPhase;}
  simulate(position,velocity,step,dt){
    if(!step||dt<=0)return;
    if(step.air)this.game._predictAirMovement(position,velocity,step.control,step.scale,dt);
    else if(step.moving)this.game._predictGroundMovement(position,step.control,step.pose,step.scale,dt);
  }
  reconcile(now){
    if(!this.pending)return;
    const {state,time,hostTime}=this.pending;this.pending=null;
    const previous=this.anchor;
    this.anchor=state;
    if(hostTime===undefined||this.hostTime!==hostTime){this.hostTime=hostTime;this.receivedAt=time;}
    const ground=this.canMove(state),air=this.canSteer(state);
    if(!(ground||air)||!Number.isFinite(state.moveTime)){
      this.history.length=0;this.lastDisplayed=null;this.timeline=null;
      this.offset.set(0,0,0);this.correction=0;
      return;
    }
    this.position.fromArray(state.position);
    if(air)this.velocity.fromArray(state.moveVelocity);
    const cutoff=Math.max(state.moveTime,now-HISTORY_SECONDS);
    this.history=this.history.filter(step=>step.end>cutoff&&step.air===!!air);
    for(const step of this.history)this.simulate(this.position,this.velocity,step,Math.min(step.duration,step.end-cutoff));
    const continuous=(ground&&this.canMove(previous)||air&&this.canSteer(previous))&&Math.hypot(...state.position.map((value,index)=>value-previous.position[index]))<SNAP_DISTANCE;
    if(!continuous){this.timeline=null;this.lastStep=null;this.clock.reset();}
    this.correction=0;this.offset.set(0,0,0);
    if(continuous&&this.lastDisplayed){
      this.renderPosition.copy(this.position);
      this.renderVelocity.copy(this.velocity);
      this.simulate(this.renderPosition,this.renderVelocity,this.lastStep,this.clock.accumulator);
      this.offset.copy(this.lastDisplayed).sub(this.renderPosition);
      if(this.offset.lengthSq()<SNAP_DISTANCE**2)this.correction=CORRECTION_SECONDS;
      else this.offset.set(0,0,0);
    }
  }
  presentAttack(dt,now){
    const attack=this.attack,actor=this.actor;
    if(!attack)return;
    if(now-attack.time>HISTORY_SECONDS||actor.networkInputAck>=attack.sequence||actor.dead||actor.networkReactionPhase||!actor.grounded){this.attack=null;return;}
    attack.timeline.advance(dt,{stopAtFrame:attack.stop});
    const {source}=attack.pose,frame=attack.timeline.frame;
    const blend=Math.min(1,(now-attack.time)/.045);
    if(attack.from&&actor.character.setPoseBlend&&blend<1)actor.character.setPoseBlend(attack.from,{source,frame},blend);
    else actor.character.setPoseFrame(source,frame);
  }
  update(dt,now,{suspended=false,airborne=false}={}){
    this.reconcile(now);
    const state=this.anchor,actor=this.actor;
    const air=!!this.canSteer(state);
    if(suspended||airborne&&!air||!(air||this.canMove(state))||!Number.isFinite(state?.moveTime)||actor.dead||actor.disposed||actor.networkReactionPhase){
      this.lastDisplayed=null;this.clock.reset();this.timeline=null;this.lastStep=null;
      return;
    }
    if(this.dirtyInput&&(this.lastStep?.moving||this.lastStep?.air)&&this.clock.accumulator>0){
      const duration=this.clock.accumulator;
      this.history.push({...this.lastStep,end:this.lastTickNow,duration});
      this.simulate(this.position,this.velocity,this.lastStep,duration);
      this.clock.reset();
    }
    this.dirtyInput=false;
    const movementAllowed=now-this.receivedAt<=HISTORY_SECONDS;
    const moving=movementAllowed&&this.isMoving&&!this.keys.has('guard')&&!this.attack;
    this.control.cameraAngle=this.game.cameraAngle;
    this.control.locked=this.game.locked;
    const visualActor={...actor,grounded:true,guard:this.keys.has('guard'),musketAim:false,heldPose:this.timeline?.pose.id??state.pose,standingTurn:null};
    const poseId=air?state.pose:this.game._groundPose(visualActor,this.control,moving);
    const scale=state.moveScale??1;
    const step={moving,air:air&&movementAllowed,pose:poseId,scale,control:{cameraAngle:this.control.cameraAngle,facing:this.control.locked?actor.root.rotation.y:undefined,keys:new Set(this.keys)}};
    this.clock.advance(dt,seconds=>{
      const end=now-this.clock.accumulator;
      if(moving||step.air){this.history.push({...step,end,duration:seconds});this.simulate(this.position,this.velocity,step,seconds);}
      while(this.history.length&&this.history[0].end<end-HISTORY_SECONDS)this.history.shift();
    });
    this.lastStep=step;this.lastTickNow=now;
    this.renderPosition.copy(this.position);
    this.renderVelocity.copy(this.velocity);
    this.simulate(this.renderPosition,this.renderVelocity,step,this.clock.accumulator);
    this.correction=Math.max(0,this.correction-dt);
    if(this.correction)this.renderPosition.addScaledVector(this.offset,this.correction/CORRECTION_SECONDS);
    this.basePosition=actor.root.position.clone();this.baseAngle=actor.root.rotation.y;
    if(air)this.renderPosition.y=this.basePosition.y;
    actor.root.position.copy(this.renderPosition);
    if(!this.control.locked&&!this.keys.has('guard'))actor.root.rotation.y=this.control.cameraAngle+Math.PI;
    this.lastDisplayed??=this.renderPosition.clone();this.lastDisplayed.copy(this.renderPosition);
    if(air)return;
    const pose=actor.combat.data.poses.get(poseId);
    if(!pose?.valid)return;
    if(this.timeline?.pose!==pose){
      this.timeline=new NativePoseTimeline(pose,{loop:true,frameTable:actor.combat.data.frameTable});
      if(state.pose===poseId)this.timeline.frame=state.frame;
    }
    const stride=nativeStrideSpeed(actor.character.nativeCharacterId??0,poseId);
    this.timeline.playbackRate=stride>0?nativeStrideSpeed(0,poseId)*scale/stride:1;
    this.timeline.advance(dt);
    if(!this.attack)actor.character.setPoseFrame(pose.source,this.timeline.frame);
  }
}
