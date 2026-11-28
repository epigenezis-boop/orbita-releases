'use strict';
const fs=require('node:fs');
function validBounds(b){return b&&['x','y','width','height'].every(k=>Number.isFinite(b[k]))&&b.width>0&&b.height>0&&Math.abs(b.x)<1e6&&Math.abs(b.y)<1e6;}
function fitBounds(bounds,areas){
 if(!areas.length)throw Error('No display available');
 const b=validBounds(bounds)?bounds:{x:0,y:0,width:420,height:188};
 const overlap=a=>Math.max(0,Math.min(b.x+b.width,a.x+a.width)-Math.max(b.x,a.x))*Math.max(0,Math.min(b.y+b.height,a.y+a.height)-Math.max(b.y,a.y));
 const area=areas.reduce((best,a)=>overlap(a)>overlap(best)?a:best,areas[0]);
 const width=Math.min(420,area.width),height=Math.min(188,area.height);
 return {x:Math.round(Math.max(area.x,Math.min(b.x,area.x+area.width-width))),y:Math.round(Math.max(area.y,Math.min(b.y,area.y+area.height-height))),width,height};
}
class WidgetPreferences{
 constructor(file){this.file=file;this.value={alwaysOnTop:true,rememberPosition:true,bounds:null};try{const v=JSON.parse(fs.readFileSync(file,'utf8'));for(const k of ['alwaysOnTop','rememberPosition'])if(typeof v[k]==='boolean')this.value[k]=v[k];if(validBounds(v.bounds))this.value.bounds=v.bounds;}catch{}}
 snapshot(){return {alwaysOnTop:this.value.alwaysOnTop,rememberPosition:this.value.rememberPosition};}
 persist(value){const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(value));fs.renameSync(tmp,this.file);this.value=value;}
 set(v){if(!v||typeof v.alwaysOnTop!=='boolean'||typeof v.rememberPosition!=='boolean')throw Error('Invalid widget settings');this.persist({...this.value,...this.snapshot(),alwaysOnTop:v.alwaysOnTop,rememberPosition:v.rememberPosition,bounds:v.rememberPosition?this.value.bounds:null});}
 saveBounds(b){if(this.value.rememberPosition&&validBounds(b))try{this.persist({...this.value,bounds:{x:b.x,y:b.y,width:b.width,height:b.height}});}catch{}}
}
module.exports={fitBounds,WidgetPreferences};
