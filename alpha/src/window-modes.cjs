'use strict';
function widgetPosition(area,width=420,height=188){return {x:Math.max(area.x,area.x+area.width-width-20),y:Math.max(area.y,area.y+area.height-height-20),width:Math.min(width,area.width),height:Math.min(height,area.height)};}
function installWindowModes(win,mini,{isQuitting=()=>false,position=()=>{},requestState=()=>{}}={}){
 const showMain=()=>{mini.hide();if(win.isMinimized())win.restore();win.show();win.focus();};
 const hideAll=()=>{mini.hide();win.hide();};
 win.on('minimize',e=>{if(isQuitting())return;e.preventDefault?.();position();win.hide();requestState();mini.showInactive();});
 win.on('show',()=>mini.hide());win.on('restore',()=>mini.hide());
 win.on('close',e=>{if(!isQuitting()){e.preventDefault();hideAll();}});
 mini.on('close',e=>{if(!isQuitting()){e.preventDefault();hideAll();}});
 return {showMain,hideAll};
}
module.exports={widgetPosition,installWindowModes};
