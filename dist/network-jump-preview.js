import {NATIVE_AIR_PHYSICS,NATIVE_JUMP_HOLD_SECONDS} from './native-traversal.js';

// Only the guest's displayed height is anticipated. The owner of the
// simulation still decides whether the jump starts and how it collides.
export class NetworkJumpPreview {
  constructor(actor,ceilingBlocked){
    this.actor=actor;
    this.ceilingBlocked=ceilingBlocked;
  }
  eligible(){
    const a=this.actor,pose=a.combat?.timeline?.pose;
    return a.grounded&&!a.dead&&!a.disposed&&!a.guard&&!a.musketAim&&!a.scriptInputBlocked&&!a.scriptCrouched&&
      !a.networkReactionPhase&&!a.networkActionBusy&&!a.combat?.busy&&!pose?.attacks?.length;
  }
  input(name,down,sequence,time){
    if(name==='clear'||(name==='guard'&&down)){this.cancel();return;}
    if(name!=='jump'||!Number.isSafeInteger(sequence))return;
    if(down){
      if(!this.charge&&!this.flight&&this.eligible())this.charge={time,elapsed:0};
      return;
    }
    if(this.charge&&this.eligible())this.begin(time-this.charge.time>=NATIVE_JUMP_HOLD_SECONDS);
    this.charge=null;
    if(this.flight)this.flight.releaseSequence=sequence;
  }
  begin(large){
    const y=this.actor.root.position.y;
    this.flight={y,origin:y,age:0,velocity:large?NATIVE_AIR_PHYSICS.largeJumpVelocity:NATIVE_AIR_PHYSICS.jumpVelocity};
    this.correction=null;
  }
  restore(){
    if(this.baseY===undefined)return;
    this.actor.root.position.y=this.baseY;
    this.baseY=undefined;
  }
  cancel(){this.restore();this.charge=null;this.flight=null;this.correction=null;this.displayY=undefined;}
  update(dt,result){
    const a=this.actor,p=a.root.position;
    if(result||a.dead||a.disposed||a.networkReactionPhase||a.guard){
      this.cancel();
      return;
    }
    if(this.charge&&!this.eligible())this.charge=null;
    if(this.charge&&(this.charge.elapsed+=dt)>=NATIVE_JUMP_HOLD_SECONDS){
      this.begin(true);
      this.charge=null;
    }
    const flight=this.flight;
    if(flight){
      const acknowledged=flight.releaseSequence!==undefined&&a.networkInputAck>=flight.releaseSequence;
      if(Math.abs(p.y-flight.origin)>6){this.cancel();return;}
      if(!a.grounded||acknowledged||flight.age>=.35){
        this.flight=null;
        this.correction={delta:(this.displayY??p.y)-p.y,remaining:.09};
      }else{
        flight.age+=dt;
        const next=Math.max(flight.origin,flight.origin+flight.velocity*flight.age-.5*NATIVE_AIR_PHYSICS.gravity*flight.age**2);
        if(!flight.blocked){
          flight.blocked=next>flight.y&&this.ceilingBlocked(p,flight.y,next-flight.y);
          if(!flight.blocked)flight.y=next;
        }
      }
    }
    let y=this.flight?.y??p.y;
    if(this.correction){
      this.correction.remaining=Math.max(0,this.correction.remaining-dt);
      y+=this.correction.delta*this.correction.remaining/.09;
      if(!this.correction.remaining)this.correction=null;
    }
    this.displayY=y;
    if(y!==p.y){this.baseY=p.y;p.y=y;}
  }
}
