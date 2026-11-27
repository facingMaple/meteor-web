import test from 'node:test';
import assert from 'node:assert/strict';
import {networkEndpoint} from '../dist/network-endpoint.js';
import {createNetworkServer} from '../network-server.mjs';
import http from 'node:http';

test('根目录、子路径及多级子路径的联机接口与游戏模块使用同一后端路径',()=>{
  for(const prefix of ['/','/lx/','/games/meteor/']){
    for(const path of ['/api/rooms/list','/api/rooms/create','/api/rooms/ABCDEF/sync','/api/rooms/ABCDEF/events']){
      assert.equal(networkEndpoint(path,`https://game.example${prefix}network-endpoint.js`),`https://game.example${prefix}${path.slice(1)}`);
    }
  }
});
test('显式HTTP地址保持不变，本地模块测试保留相对接口兼容',()=>{
  assert.equal(networkEndpoint('http://127.0.0.1:1234/api/rooms/list','https://game.example/lx/network-endpoint.js'),'http://127.0.0.1:1234/api/rooms/list');
  assert.equal(networkEndpoint('/api/rooms/list','file:///C:/game/network-endpoint.js'),'/api/rooms/list');
});
test('浏览器子路径环境中的实际POST使用子路径接口，而非域名根接口',async()=>{
  const original=globalThis.fetch,called=[];
  try{
    globalThis.fetch=async(url,options)=>{called.push({url,options});return new Response(JSON.stringify({rooms:[]}),{headers:{'Content-Type':'application/json'}});};
    // Re-load the production client with its URL resolver bound to a deployed
    // module URL. All other imports remain production modules on disk.
    const {readFile}=await import('node:fs/promises');let source=await readFile(new URL('../dist/network-client.js',import.meta.url),'utf8');
    source=source.replace("from './network-rules.js'",`from '${new URL('../dist/network-rules.js',import.meta.url)}'`)
      .replace("from './network-push-stream.js'",`from '${new URL('../dist/network-push-stream.js',import.meta.url)}'`)
      .replace("import {networkEndpoint} from './network-endpoint.js';",`import {networkEndpoint as resolveEndpoint} from '${new URL('../dist/network-endpoint.js',import.meta.url)}';const networkEndpoint=p=>resolveEndpoint(p,'https://game.example/lx/network-endpoint.js');`);
    const {NetworkClient:DeployedClient}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
    await new DeployedClient().api('/api/rooms/list');assert.equal(called[0].url,'https://game.example/lx/api/rooms/list');assert.equal(called[0].options.method,'POST');
  }finally{globalThis.fetch=original;}
});

test('子路径反向代理下两个独立身份看到同一个房间并能建立实时推送',async()=>{
  const upstream=createNetworkServer();await new Promise(resolve=>upstream.listen(0,'127.0.0.1',resolve));
  const proxy=http.createServer((req,res)=>{
    if(!req.url.startsWith('/lx/')){res.writeHead(404);res.end();return;}
    const target=http.request({hostname:'127.0.0.1',port:upstream.address().port,path:req.url.slice(3),method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    target.on('error',()=>res.destroy());res.on('close',()=>target.destroy());req.pipe(target);
  });await new Promise(resolve=>proxy.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${proxy.address().port}`,moduleUrl=base+'/lx/network-endpoint.js',abort=new AbortController();let created;
  const post=async(path,data)=>{const r=await fetch(networkEndpoint(path,moduleUrl),{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(data)});assert.equal(r.status,200);return r.json();};
  try{
    created=await post('/api/rooms/create',{name:'公网验证房主'});const listed=await post('/api/rooms/list',{});
    assert.ok(listed.rooms.some(r=>r.code===created.room.code));const joined=await post('/api/rooms/join',{code:created.room.code,name:'另一位访问者'});assert.equal(joined.room.players.length,2);
    const stream=await fetch(networkEndpoint(`/api/rooms/${created.room.code}/events`,moduleUrl),{headers:{Authorization:'Bearer '+joined.token,Origin:base},signal:abort.signal});assert.equal(stream.status,200);
    const {value}=await stream.body.getReader().read();const packet=JSON.parse(new TextDecoder().decode(value).trim());assert.equal(packet.room.players.length,2);
  }finally{abort.abort();proxy.closeAllConnections();upstream.closeAllConnections();await Promise.all([new Promise(r=>proxy.close(r)),new Promise(r=>upstream.close(r))]);}
});
