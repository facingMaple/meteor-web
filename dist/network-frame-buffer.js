// A short presentation queue absorbs HTTP arrival jitter. It never predicts
// positions, executes inputs, or advances authoritative combat.
export class NetworkFrameBuffer {
  constructor(apply,{delay=1/30,maxFrames=8}={}){this.apply=apply;this.delay=delay;this.maxFrames=maxFrames;this.clear();}
  clear(){this.frames=[];this.latestSequence=0;this.latestTime=null;this.clock=null;this.current=null;this.lastArrival=null;this.jitter=0;this.adjusted=false;}
  get targetDelay(){return this.delay+Math.min(.075,Math.max(0,2*(this.jitter-.018)));}
  get sample(){
    if(!this.current)return null;
    const from=this.current,to=this.frames[0]||from,span=to.time-from.time;
    return {from,to,weight:span>0?Math.max(0,Math.min(1,(this.clock-from.time)/span)):0};
  }
  receive(frame,arrival){
    if(!frame||!Number.isSafeInteger(frame.sequence)||!Number.isFinite(frame.time)||frame.sequence<=this.latestSequence||this.latestTime!==null&&frame.time<this.latestTime)return;
    if(Number.isFinite(arrival)&&Number.isFinite(this.lastArrival)&&frame.time>this.latestTime){
      const variation=Math.abs((arrival-this.lastArrival)-(frame.time-this.latestTime));
      this.jitter+=.15*(Math.min(.12,variation)-this.jitter);
    }
    if(Number.isFinite(arrival)&&frame.time!==this.latestTime)this.lastArrival=arrival;
    this.latestSequence=frame.sequence;this.latestTime=frame.time;
    if(this.clock===null||frame.result){this.frames=[];this.clock=frame.time-this.targetDelay;this.current=frame;this.apply(frame);return;}
    if(this.frames.at(-1)?.time===frame.time)this.frames.pop();
    this.frames.push(frame);
    if(this.frames.length>this.maxFrames)this.frames.splice(0,this.frames.length-this.maxFrames);
    // Resume near the live stream after a long outage instead of replaying
    // seconds of stale movement. Ordinary packet jitter keeps its cadence.
    if(frame.time-this.clock>.25)this.clock=frame.time-this.targetDelay;
  }
  update(dt){
    if(this.clock===null||!Number.isFinite(dt)||dt<=0)return;
    const extra=this.targetDelay-this.delay;
    const depth=this.latestTime-this.clock;
    if(extra>0)this.adjusted=true;
    const rate=extra>0&&depth<this.targetDelay-.015?.9:this.adjusted&&depth>this.targetDelay+.05?1.08:1;
    this.clock=Math.min(this.latestTime,this.clock+dt*rate);
    while(this.frames.length&&this.frames[0].time<=this.clock+1e-9){this.current=this.frames.shift();this.apply(this.current);}
  }
}
