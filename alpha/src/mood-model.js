(function(root,factory){const model=factory();if(typeof module==='object'&&module.exports)module.exports=model;else root.OrbitaMood=model;})(typeof globalThis==='object'?globalThis:this,()=>{
 'use strict';const clamp=(v,min,max)=>Math.max(min,Math.min(max,Number.isFinite(v)?v:min));
 // UI axes are an adapter for the existing energy/fun protocol, not new API fields.
 return {fromPoint(x,y){return {energy:Math.round((1-clamp(y,0,1))*150)/100,fun:Math.round(clamp(x,0,1)*200)/100};},toPoint(energy,fun){return {x:clamp(fun/2,0,1),y:1-clamp(energy/1.5,0,1)};},defaults:{energy:.75,fun:1.03}};
});
