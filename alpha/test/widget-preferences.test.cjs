const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {fitBounds,WidgetPreferences}=require('../src/widget-preferences.cjs');
test('widget recovers from a removed monitor and keeps negative display coordinates',()=>{
 const left={x:-2560,y:0,width:2560,height:1400},right={x:0,y:0,width:2560,height:1400};
 const b={x:-2400,y:400,width:420,height:188};assert.deepEqual(fitBounds(b,[right,left]),b);
 const recovered=fitBounds(b,[right]);assert.equal(recovered.x,0);assert.equal(recovered.y,400);
 assert.deepEqual(fitBounds({x:9000,y:9000,width:420,height:188},[{x:0,y:0,width:300,height:150}]),{x:0,y:0,width:300,height:150});
});
test('widget preferences survive restart; disabled position memory drops old coordinates',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'orbita-widget-'));try{const file=path.join(dir,'prefs.json'),p=new WidgetPreferences(file);assert.deepEqual(p.snapshot(),{alwaysOnTop:true,rememberPosition:true});p.saveBounds({x:-400,y:200,width:420,height:188});p.set({alwaysOnTop:false,rememberPosition:true});const restored=new WidgetPreferences(file);assert.equal(restored.value.bounds.x,-400);assert.equal(restored.value.alwaysOnTop,false);restored.set({alwaysOnTop:false,rememberPosition:false});restored.saveBounds({x:3,y:4,width:420,height:188});assert.equal(new WidgetPreferences(file).value.bounds,null);assert.throws(()=>restored.set({alwaysOnTop:'yes',rememberPosition:true}));fs.writeFileSync(file,'broken');assert.equal(new WidgetPreferences(file).value.alwaysOnTop,true);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
