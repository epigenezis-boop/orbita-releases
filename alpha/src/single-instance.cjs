'use strict';
function focusWindow(window){
 if(!window||window.isDestroyed())return;
 if(window.isMinimized())window.restore();
 window.show();window.focus();
}
function singleInstance(app,getWindow){
 if(!app.requestSingleInstanceLock()){app.quit();return false;}
 app.on('second-instance',()=>focusWindow(getWindow()));
 app.on('activate',()=>focusWindow(getWindow()));
 return true;
}
module.exports={singleInstance,focusWindow};
