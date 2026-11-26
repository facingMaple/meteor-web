import {NETWORK_PROTOCOL} from './network-rules.js';
import {NetworkPushStream} from './network-push-stream.js';
import {networkEndpoint} from './network-endpoint.js';
const continuous=['forward','back','left','right','guard','crouch'];
const MAX_IN_FLIGHT=6;
const UPLOAD_RETRY_LIMIT_SECONDS=12;
export const NETWORK_SYNC_MS=1000/30;
export class NetworkClient{
  constructor({onRoom=()=>{},onInput=()=>{},onFrame=()=>{},onError=()=>{},getFrame=()=>null,getAngle=()=>0,getPitch=()=>0,now=()=>performance.now()/1000,stream=typeof window!=='undefined',streamUrl=path=>path,pipelined=true}={}){
    Object.assign(this,{onRoom,onInput,onFrame,onError,getFrame,getAngle,getPitch,now});this.resetInput();this.failures=0;this.closed=false;
    this.enableStream=stream;this.streamUrl=streamUrl;this.enablePipelining=pipelined;
  }
  resetInput(){this.queue=[];this.held=new Set();this.pendingInput=null;this.sequence=0;this.processed=new Map();this.lastReceivedFrameSequence=0;this.upload={inFlight:0,serial:0,lastSuccess:0,lastFailure:0};}
  setRoom(room){
    if(room.protocol!==NETWORK_PROTOCOL||!Number.isSafeInteger(room.round)||!Number.isSafeInteger(room.revision??0)||(room.revision??0)<0)throw Error('联机协议已更新，请重启服务并刷新所有玩家页面。');
    const previous=this.room,sameRoom=previous?.code===room.code;
    if(sameRoom&&(room.round<previous.round||room.round===previous.round&&(room.revision??0)<(previous.revision??0)))return false;
    if(!sameRoom||previous.round!==room.round)this.resetInput();
    this.room=room;
    // Moving and fighting changes snapshots, not the list of participants.
    // Refresh the lobby and reconcile actor membership only on room changes.
    if(sameRoom&&previous.round===room.round&&previous.revision===room.revision&&previous.phase===room.phase)return true;
    const playerIds=new Set(room.players.map(player=>player.id));
    for(const id of this.processed.keys())if(!playerIds.has(id))this.processed.delete(id);
    this.onRoom(room);return true;
  }
  fail(message){if(this.closed)return;this.closed=true;this.streamer?.stop();clearInterval(this.timer);this.resetInput();this.onError(message);}
  measureRelay(start){
    const sample=this.now()-start;
    if(!Number.isFinite(sample)||sample<=0)return;
    this.relayRtt=this.relayRtt===undefined?sample:this.relayRtt+.15*(sample-this.relayRtt);
  }
  async api(path,data={},auth=false){
    path=networkEndpoint(path);
    const controller=typeof AbortController==='function'?new AbortController():null;let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('连接超时，请确认使用同一个游戏地址后重试。'));controller?.abort();},6000);});
    try{return await Promise.race([deadline,(async()=>{
      const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer '+this.token}:{})},body:JSON.stringify(data),...(controller?{signal:controller.signal}:{})});
      if(!response.headers.get('Content-Type')?.includes('application/json'))throw Error(`房间接口未返回 JSON（HTTP ${response.status}），请检查游戏地址和部署代理。`);
      const result=await response.json();if(!response.ok)throw Object.assign(Error(result.error||'联机请求失败'),{status:response.status});return result;
    })()]);}catch(error){if(error instanceof TypeError)throw Error('无法连接联机服务，请确认大家使用同一个游戏地址。');throw error;}finally{clearTimeout(timer);}
  }

  async connect(kind,data){
    const result=await this.api('/api/rooms/'+kind,data);
    Object.assign(this,{token:result.token,playerId:result.playerId,code:result.room.code});
    // A room may be created after the user has already left the connecting UI.
    // Release that server identity without callbacks or a resurrected timer.
    if(this.closed){try{await this.command('leave');}catch{}return null;}
    try{this.setRoom(result.room);}catch(error){await this.leave().catch(()=>{});throw error;}
    if(this.closed)return null;
    this.timer=setInterval(()=>this.sync(),NETWORK_SYNC_MS);this.startStream();return result;
  }
  startStream(){
    if(this.closed||!this.enableStream||this.room?.stream!==1||this.streamer)return;
    const code=this.code;
    this.streamer=new NetworkPushStream({url:networkEndpoint(this.streamUrl(`/api/rooms/${code}/events`)),token:this.token,
      onStatus:active=>{this.streamActive=active&&!this.closed;},onPacket:result=>{
        if(this.closed||this.code!==code||result.room?.code!==code)return;
        try{if(!this.setRoom(result.room))return;if(this.closed)return;
          if(result.room.phase==='playing'&&this.host)this.applyInputs(result.input||[]);
          if(result.frame)this.deliverFrame(result.frame);
        }catch(error){this.fail('联机状态处理失败：'+error.message);}
      }});this.streamer.start();
  }
  deliverFrame(frame){
    if(frame.sequence<=this.lastReceivedFrameSequence)return;
    this.lastReceivedFrameSequence=frame.sequence;this.onFrame(frame);
  }
  applyInputs(inputs){
    for(const input of inputs){const previous=this.processed.get(input.playerId)||0;
      if(input.sequence!==0&&input.sequence<=previous)continue;
      this.onInput([input]);if(input.sequence>0)this.processed.set(input.playerId,input.sequence);
    }
  }
  get host(){return this.room?.hostId===this.playerId;}
  async command(action,data={}){const result=await this.api(`/api/rooms/${this.code}/${action}`,data,true);if(!this.closed&&result.room)this.setRoom(result.room);return result;}
  send(action,active=true,viewTime){
    if(this.closed||this.host||this.room?.phase!=='playing')return;
    // Never silently discard queued attacks. Close explicitly on overload.
    if(this.queue.length+(this.pendingInput?.length||0)>=256){this.fail('联机操作积压过多，本局已断开，请重新加入。');return;}
    if(continuous.includes(action)){if(active)this.held.add(action);else this.held.delete(action);}if(action==='clear')this.held.clear();
    this.queue.push({action,active:!!active,sequence:++this.sequence,angle:this.getAngle(),pitch:this.getPitch(),time:this.now(),...(viewTime===undefined?{}:{viewTime})});
    this.flushInput();
    return this.sequence;
  }
  // Coalesce events from the same task, but do not make a key press wait for
  // the next poll. One in-flight request still owns its exact retry batch.
  flushInput(){
    if(!this.timer||this.closed||this.host||this.room?.phase!=='playing'||!this.queue.length||this.inputScheduled)return;
    this.inputScheduled=true;queueMicrotask(()=>{this.inputScheduled=false;this.sync();});
  }
  // Called after the host has actually simulated a newly received input.
  // Publish that result without another full polling interval of latency.
  flushFrame(){
    if(!this.timer||this.closed||!this.host||this.room?.phase!=='playing')return;
    this.frameDirty=true;
    if(this.busy||this.frameScheduled)return;
    this.frameScheduled=true;queueMicrotask(()=>{this.frameScheduled=false;this.sync();});
  }
  async syncPipelined(){
    const upload=this.upload;
    if(upload.inFlight>=MAX_IN_FLIGHT||this.now()<(upload.retryAt??0))return;
    const {code,host}=this,round=this.room.round,data={round,fastSync:1};
    if(host){
      this.frameDirty=false;data.inputAck=Object.fromEntries(this.processed);
      const frame=this.getFrame();if(frame)data.frame=frame;
    }else{
      const last=this.queue.at(-1);
      if(!last||last.action==='look'&&this.now()-last.time>=NETWORK_SYNC_MS/1000&&this.queue.length<MAX_IN_FLIGHT){
        this.queue.push({action:'look',active:false,sequence:++this.sequence,angle:this.getAngle(),pitch:this.getPitch(),time:this.now(),held:[...this.held]});
      }
      // Each newer upload includes the outstanding action prefix. The relay
      // can process either arrival order while every input edge stays reliable.
      data.input=this.queue.slice(0,64);
      if(this.streamActive)data.afterFrame=this.lastReceivedFrameSequence;
    }
    const serial=++upload.serial;
    upload.inFlight++;
    const start=this.now();
    const current=()=>!this.closed&&this.code===code&&this.room.round===round&&this.upload===upload;
    try{
      let result;
      try{result=await this.api(`/api/rooms/${code}/sync`,data,true);}
      catch(error){
        if(current()&&serial>upload.lastSuccess&&serial>upload.lastFailure){
          upload.lastFailure=serial;
          const now=this.now();
          upload.unavailableSince??=start;
          if(now>=(upload.retryAt??0))this.failures++;
          upload.retryAt=now+Math.min(.8,.05*2**Math.min(this.failures,4));
          if(error.status===403||error.status===404||now-upload.unavailableSince>=UPLOAD_RETRY_LIMIT_SECONDS)this.fail(error.message);
        }
        return;
      }
      if(!current())return;
      this.measureRelay(start);
      if(!this.setRoom(result.room)||!current())return;
      if(!host&&result.room.phase==='playing'){
        if(!Number.isSafeInteger(result.acceptedSequence)||result.acceptedSequence<(data.input.at(-1)?.sequence??0))throw Error('服务未确认完整操作批次。');
        const acknowledged=this.queue.findIndex(input=>input.sequence>result.acceptedSequence);
        this.queue.splice(0,acknowledged<0?this.queue.length:acknowledged);
      }
      if(host&&result.room.phase==='playing')this.applyInputs(result.input||[]);
      if(result.frame)this.deliverFrame(result.frame);
      if(serial>=upload.lastFailure){this.failures=0;upload.retryAt=0;upload.unavailableSince=undefined;}
      upload.lastSuccess=Math.max(upload.lastSuccess,serial);
    }catch(error){if(current())this.fail('联机状态处理失败：'+error.message);}finally{
      upload.inFlight--;
      if(current()&&this.frameDirty)this.flushFrame();
    }
  }
  async sync(){
    if(!this.closed&&this.code&&this.room?.phase==='playing'&&this.enablePipelining&&this.room.fastSync===1)return this.syncPipelined();
    if(this.busy||this.closed||!this.code)return;this.busy=true;
    const code=this.code,round=this.room.round,playing=this.room.phase==='playing',host=this.host,data={};
    const start=this.now();
    try{
      if(playing){
        data.round=round;
        if(host){this.frameDirty=false;data.inputAck=Object.fromEntries(this.processed);const frame=this.getFrame();if(frame)data.frame=frame;}
        else{
          // A later look sequence must never jump ahead of queued operations.
          if(!this.pendingInput){this.pendingInput=this.queue.splice(0,63);if(!this.queue.length)this.pendingInput.push({action:'look',active:false,sequence:++this.sequence,angle:this.getAngle(),pitch:this.getPitch(),time:this.now(),held:[...this.held]});}
          data.input=this.pendingInput;if(this.streamActive)data.afterFrame=this.lastReceivedFrameSequence;
        }
      }
      let result;
      try{result=await this.api(`/api/rooms/${code}/sync`,data,true);}
      catch(error){if(!this.closed&&this.code===code&&this.room.round===round&&++this.failures>=3)this.fail(error.message);return;}
      // Discard responses belonging to a room or round which is no longer active.
      if(this.closed||this.code!==code||this.room.round!==round)return;
      this.measureRelay(start);
      this.failures=0;if(!this.setRoom(result.room))return;
      if(this.closed||result.room.round!==round)return;if(result.room.phase==='finished'){if(result.frame)this.deliverFrame(result.frame);return;}if(result.room.phase!=='playing')return;
      if(!host&&playing){
        const last=this.pendingInput?.at(-1)?.sequence||0;
        if(!Number.isSafeInteger(result.acceptedSequence)||result.acceptedSequence<last)throw Error('服务未确认完整操作批次，本局已停止。');
        this.pendingInput=null;
      }
      if(host)this.applyInputs(result.input||[]);
      if(result.frame)this.deliverFrame(result.frame);
    }catch(error){this.fail('联机状态处理失败：'+error.message);}
    finally{this.busy=false;if(!this.pendingInput)this.flushInput();if(this.frameDirty)this.flushFrame();}
  }
  async leave(){this.closed=true;this.streamer?.stop();clearInterval(this.timer);this.resetInput();if(this.code)await this.command('leave');}
}
