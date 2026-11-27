// Host-owned target history for ordinary sword contacts. Only the spatial
// query is rewound; the live fighter still receives guard, damage and reactions.
const MAX_REWIND=.25;
const MAX_VIEW_AGE=.35;
const TELEPORT_DISTANCE_SQUARED=1.25**2;

export class NetworkMeleeHistory {
  tracks=new WeakMap();
  swings=new WeakMap();

  capture(time,actors){
    for(const actor of actors){
      let track=this.tracks.get(actor);
      const last=track?.at(-1),position=actor.root.position;
      if(!track||actor.dead||actor.disposed||actor.scriptRemoved||last&&last.position.distanceToSquared(position)>TELEPORT_DISTANCE_SQUARED){
        track=[];this.tracks.set(actor,track);
      }
      if(actor.dead||actor.disposed||actor.scriptRemoved||track.at(-1)?.time===time)continue;
      track.push({time,position:position.clone()});
      while(track.length>2&&track[1].time<time-MAX_REWIND)track.shift();
    }
  }

  delay(time,viewTime){
    if(!Number.isFinite(viewTime)||viewTime<0)return 0;
    const delay=time-viewTime;
    return delay>0&&delay<=MAX_VIEW_AGE?Math.min(delay,MAX_REWIND):0;
  }

  begin(actor,serial,delay){
    if(delay>0)this.swings.set(actor,{serial,delay});else this.swings.delete(actor);
  }

  positionAtStrike(attacker,target,serial,time){
    const swing=this.swings.get(attacker),track=this.tracks.get(target);
    if(swing?.serial!==serial||!track?.length||!attacker.grounded)return null;
    const newest=track.at(-1),query=time-swing.delay;
    if(query<track[0].time||query>newest.time||newest.position.distanceToSquared(target.root.position)>TELEPORT_DISTANCE_SQUARED)return null;
    for(let index=1;index<track.length;index++){
      const after=track[index];
      if(after.time<query)continue;
      const before=track[index-1];
      return before.position.clone().lerp(after.position,(query-before.time)/(after.time-before.time));
    }
    return newest.position.clone();
  }
}
