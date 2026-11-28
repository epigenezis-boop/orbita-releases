const test=require('node:test'),assert=require('node:assert/strict'),{API}=require('../src/api.cjs');
test('favorites validate IDs, use track collection type and require service confirmation',async()=>{const sent=[];const api=new API(async(_url,p)=>{sent.push(p);return {data:{collection:{addItem:true,removeItem:true}}};});api.token='test';assert.equal(await api.likeTrack('123',true),true);assert.equal(await api.likeTrack('123',false),false);assert.deepEqual(sent[0].variables,{id:'123',type:'track'});assert.match(sent[0].query,/addItem/);assert.match(sent[1].query,/removeItem/);await assert.rejects(()=>api.likeTrack('local-x',true));api.request=async()=>({data:{collection:{addItem:false}}});await assert.rejects(()=>api.likeTrack('123',true));});

test('unconfirmed favorites explain refresh without claiming success',async()=>{
 const api=new API(async()=>({data:{collection:{addItem:null,removeItem:null}}}));api.token='test';
 await assert.rejects(api.likeTrack('123',true),e=>/добавление в любимые/.test(e.message)&&/Коллекция Zvuk/.test(e.message)&&/проверить результат/.test(e.message));
 await assert.rejects(api.likeTrack('123',false),/удаление из любимых/);
});
