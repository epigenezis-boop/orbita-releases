const {test}=require('node:test'),assert=require('node:assert/strict'),{StreamRequests}=require('../src/stream-requests.cjs');
const turn=()=>new Promise(r=>setImmediate(r));
test('duplicate stream requests share one call; rapid skipping issues only latest pending track',async()=>{
 const calls=[],gates=[];const s=new StreamRequests((id,q)=>{calls.push(id);return new Promise(r=>gates.push(r));});
 const a=s.request('1','high'),duplicate=s.request('1','high');assert.equal(a,duplicate);await turn();
 const b=s.request('2','high');const rejected=assert.rejects(b,/PLAYBACK_SUPERSEDED/);const c=s.request('3','high');const rejected2=assert.rejects(c,/PLAYBACK_SUPERSEDED/);const d=s.request('4','high');assert.deepEqual(calls,['1']);gates.shift()('one');await a;await turn();assert.deepEqual(calls,['1','4']);gates.shift()('four');assert.equal(await d,'four');await rejected;await rejected2;
});
test('device limit latches, rejects queued and repeated requests and survives reconstruction',async()=>{
 let count=0,persisted=null;const s=new StreamRequests(async()=>{count++;throw Error('[DEVICE_LIMIT/STREAM] device limit');},{changed:x=>persisted=x});
 await assert.rejects(s.request('1','high'),/DEVICE_LIMIT/);await turn();for(let i=0;i<10;i++)await assert.rejects(s.request('2','high'),/DEVICE_LIMIT/);assert.equal(count,1);assert.match(persisted,/DEVICE_LIMIT/);
 const restarted=new StreamRequests(async()=>{count++;return 'ok';},{blocked:persisted});await assert.rejects(restarted.request('1','high'),/DEVICE_LIMIT/);assert.equal(count,1);restarted.unblock();assert.equal(await restarted.request('1','high'),'ok');assert.equal(count,2);
});
test('ordinary failures are not automatically retried; pending local transition can be cancelled',async()=>{
 let n=0;const s=new StreamRequests(async()=>{n++;throw Error('network');});await assert.rejects(s.request('1','high'),/network/);await turn();assert.equal(n,1);
 let release;const gate=new StreamRequests(()=>new Promise(r=>release=r));const a=gate.request('1','high');await turn();const b=gate.request('2','high'),r=assert.rejects(b,/SUPERSEDED/);gate.cancelPending();release('url');await a;await r;
});
