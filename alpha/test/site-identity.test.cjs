const {test}=require('node:test'),assert=require('node:assert/strict');
const {SiteIdentity}=require('../src/site-identity.cjs');
const {ZvukTransport}=require('../src/zvuk-transport.cjs');
const observed={'X-Device-ID':'existing-device','x-app-instance':'existing-instance',Cookie:'other=1; device_id=existing-device'};
const cookies=value=>({cookies:{get:async()=>value===null?[]:[{value}]}});
test('reuses only observed identity matching current device cookie, including restart',async()=>{
 let saved;const events=[];const identity=new SiteIdentity({save:v=>saved=v,event:x=>events.push(x)});identity.observe(observed);
 assert.deepEqual(await identity.headers(cookies('existing-device'),true),{'X-Device-Id':'existing-device','X-App-Instance':'existing-instance'});
 const restored=new SiteIdentity({load:()=>saved});assert.deepEqual(await restored.headers(cookies('existing-device'),true),await identity.headers(cookies('existing-device'),true));
 await assert.rejects(restored.headers(cookies('new-device'),true),/SITE_IDENTITY_REQUIRED/);await assert.rejects(restored.headers(cookies(null),true),/SITE_IDENTITY_REQUIRED/);
 assert.deepEqual(events,['observed','reused','reused']);identity.clear();assert.equal(saved,null);
});
test('missing, ambiguous and malformed identity never becomes a generated fallback',async()=>{
 for(const h of [{...observed,Cookie:'device_id=other'},{...observed,'X-Device-ID':'bad\r\nvalue'},{...observed,'x-app-instance':''},{...observed,Cookie:'device_id=existing-device; device_id=existing-device'}]){
 const i=new SiteIdentity();i.observe(h);assert.deepEqual(await i.headers(cookies('existing-device')),{});await assert.rejects(i.headers(cookies('existing-device'),true),/SITE_IDENTITY_REQUIRED/);
 }
});
test('stream transport sends existing identity and token once, without login or retry',async()=>{
 let n=0;const web={...cookies('existing-device'),fetch:async(url,o)=>{n++;assert.equal(url,'https://zvuk.com/api/v1/graphql');assert.equal(o.headers['X-Device-Id'],'existing-device');assert.equal(o.headers['X-App-Instance'],'existing-instance');assert.equal(o.headers['X-Auth-Token'],'saved-token');return {ok:true,headers:new Headers({'content-type':'application/json'}),json:async()=>({data:{}})};}};
 const i=new SiteIdentity();const t=new ZvukTransport(web,i);await assert.rejects(t.request('/api/v1/graphql',{query:'query getStream($ids:[ID!]!){mediaContents(ids:$ids){id}}'},'saved-token'),/SITE_IDENTITY_REQUIRED/);assert.equal(n,0);i.observe(observed);await t.request('/api/v1/graphql',{query:'query getStream($ids:[ID!]!){mediaContents(ids:$ids){id}}'},'saved-token');assert.equal(n,1);
});
