const {test}=require('node:test'),assert=require('node:assert/strict');
const {MediaBroker}=require('../src/media.cjs');
test('24 track switches cancel old downloads even when protocol request never aborts',async()=>{
 let live=0,canceled=0;const signals=[];
 const broker=new MediaBroker({},async(_url,opts)=>{signals.push(opts.signal);live++;return new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));},cancel(){live--;canceled++;}}));});
 for(let i=0;i<24;i++){
  const url=broker.issue('https://cdn.example/track'+i);
  const response=await broker.handle(new Request(url));
  const reader=response.body.getReader();await reader.read();
  assert.equal(live,1);assert.equal(broker.active.size,1);
  if(i)assert.equal(signals[i-1].aborted,true);
 }
 broker.stopRemote();await new Promise(r=>setImmediate(r));
 assert.equal(live,0);assert.equal(canceled,24);assert.equal(broker.active.size,0);
});
test('canceling downstream body releases upstream request and reader',async()=>{
 let canceled=false,signal;
 const broker=new MediaBroker({},async(_u,o)=>{signal=o.signal;return new Response(new ReadableStream({cancel(){canceled=true;}}));});
 const response=await broker.handle(new Request(broker.issue('https://cdn.example/music')));
 await response.body.cancel();assert.equal(canceled,true);assert.equal(signal.aborted,true);assert.equal(broker.active.size,0);
});
test('completed audio removes request from active downloads',async()=>{
 const broker=new MediaBroker({},async()=>new Response('audio'));
 const response=await broker.handle(new Request(broker.issue('https://cdn.example/music')));
 assert.equal(await response.text(),'audio');assert.equal(broker.active.size,0);
});
test('switch while awaiting headers cancels fetch without a spurious network error',async()=>{
 const events=[];const broker=new MediaBroker({},(_u,o)=>new Promise((_resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('aborted')))),e=>events.push(e));
 const pending=broker.handle(new Request(broker.issue('https://cdn.example/one')));
 broker.issue('https://cdn.example/two');await pending;
 assert.equal(broker.active.size,0);assert.deepEqual(events,[]);
});
