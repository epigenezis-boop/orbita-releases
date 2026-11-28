const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const src=fs.readFileSync(path.join(__dirname,'../src/renderer.js'),'utf8');
test('current-track hearts share pending request and update collection once',async()=>{
 let resolve,n=0;const ctx={OrbitaI18n:require('../src/i18n.js'),likedIds:[],likedTracks:[],likedOffset:0,connected:true,sessionTicket:1,view:'album',visible:[],call:()=>{n++;return new Promise(r=>resolve=r)},paintCurrentHeart:()=>{},publishPlayerState:()=>{},render:()=>{},notice:()=>{},login:()=>{},element:()=>({setAttribute(){}})};vm.createContext(ctx);
 const code=src.slice(src.indexOf('const heartPending='),src.indexOf('function paintCurrentHeart'));
 vm.runInContext(code+';globalThis.make=makeHeart;',ctx);const t={id:'123',title:'Song'},a=ctx.make(t),b=ctx.make(t),event={stopPropagation(){}};
 const pending=a.onclick(event);await b.onclick(event);assert.equal(n,1);assert.equal(ctx.make(t).disabled,true);resolve(true);await pending;assert.equal(ctx.likedIds[0],'123');assert.equal(ctx.make(t).disabled,false);
});
test('widget sends exact displayed track id, hides heart on local tracks',()=>{
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{style:{},addEventListener(){},setAttribute(){},getAttribute(){},replaceChildren(){},append(){}});return elements.get(id)};let state,action;
 const ctx={OrbitaI18n:require('../src/i18n.js'),document:{getElementById:get,createElement:()=>({style:{}}),createElementNS:()=>({setAttribute(){},append(){}}),documentElement:{dataset:{}}},window:{addEventListener(){},mini:{action:(...x)=>action=x,onState:fn=>state=fn,onTheme(){},onSpectrum(){}}}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/widget.js'),'utf8'),ctx);state({trackId:'123',canLike:true,liked:true,volume:.7});get('like').onclick();assert.deepEqual(action,['like','123']);assert.equal(get('like').disabled,true);state({trackId:'local-1',canLike:false});assert.equal(get('like').hidden,true);
});
