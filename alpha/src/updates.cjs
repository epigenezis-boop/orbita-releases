'use strict';
// The updater has no access to Zvuk API, account storage or its web session.
class Updates {
 constructor({updater,version,supported,load=()=>true,save=()=>{},changed=()=>{},beforeInstall=()=>{},setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now}){
  Object.assign(this,{updater,version,supported,save,changed,beforeInstall,setTimer,clearTimer,now});
  let automatic=true;try{automatic=load()!==false;}catch{}
  this.state={version,automatic,supported,status:supported?'idle':'unsupported',availableVersion:null,progress:0,checkedAt:null};
  this.checking=null;this.downloading=null;this.lastCheck=-Infinity;this.timer=null;this.installing=false;
  if(!supported)return;
  updater.autoDownload=false;updater.autoInstallOnAppQuit=false;updater.allowPrerelease=false;updater.allowDowngrade=false;
  updater.on('checking-for-update',()=>this.update({status:'checking',error:null}));
  updater.on('update-available',info=>{
   // Stable Orbita Windows x64 installers only. No Dual, Local or preview builds.
   const v=info?.version;
   const newer=(a,b)=>{const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]>y[i];}return false;};
   if(!/^\d+\.\d+\.\d+$/.test(v||'')||!newer(v,this.version)||info.files?.length!==1||!info.files?.some(f=>{try{return decodeURIComponent(new URL(f.url,'https://github.com/').pathname).split('/').pop()===`Orbita-Setup-${v}-x64.exe`;}catch{return false;}})){
    this.update({status:'error',error:'Выпуск не подходит для этой версии Orbita.',availableVersion:null});return;
   }
   this.update({status:'available',availableVersion:v,progress:0,error:null,checkedAt:this.now()});
   if(this.state.automatic)this.download().catch(()=>{});
  });
  updater.on('update-not-available',()=>this.update({status:'idle',availableVersion:null,error:null,checkedAt:this.now()}));
  updater.on('download-progress',p=>{const n=Math.max(0,Math.min(100,Math.floor(Number(p.percent)||0)));if(n!==this.state.progress)this.update({status:'downloading',progress:n});});
  updater.on('update-downloaded',()=>this.update({status:'downloaded',progress:100,error:null}));
  updater.on('error',()=>this.fail());
 }
 snapshot(){return {...this.state};}
 update(patch){Object.assign(this.state,patch);this.changed(this.snapshot());}
 fail(){this.installing=false;this.update({status:'error',error:'Не удалось получить обновление. Проверь соединение и повтори позже. Музыка продолжит работать.'});}
 start(){if(this.supported)this.schedule(45000);}
 schedule(delay){if(this.timer)this.clearTimer(this.timer);this.timer=this.setTimer(async()=>{try{if(this.state.automatic)await this.check();}catch{}finally{this.schedule(6*60*60*1000);}},delay);this.timer?.unref?.();}
 setAutomatic(value){if(typeof value!=='boolean')throw Error('Некорректная настройка обновлений');this.save(value);this.update({automatic:value});return this.snapshot();}
 check(){
  if(!this.supported)return Promise.resolve(this.snapshot());
  if(this.checking)return this.checking;
  if(this.downloading||this.state.status==='downloaded'||this.now()-this.lastCheck<30000)return Promise.resolve(this.snapshot());
  this.lastCheck=this.now();this.update({status:'checking',error:null});
  this.checking=Promise.resolve().then(()=>this.updater.checkForUpdates()).then(()=>this.snapshot(),()=>{this.fail();return this.snapshot();}).finally(()=>{this.checking=null;});return this.checking;
 }
 download(){
  if(!this.supported)return Promise.resolve(this.snapshot());
  if(this.downloading)return this.downloading;
  if(!this.state.availableVersion||!['available','error'].includes(this.state.status))return Promise.resolve(this.snapshot());
  this.update({status:'downloading',progress:0,error:null});
  this.downloading=Promise.resolve().then(()=>this.updater.downloadUpdate()).then(()=>this.snapshot(),()=>{this.fail();return this.snapshot();}).finally(()=>{this.downloading=null;});return this.downloading;
 }
 install(relaunch=true){
  if(!this.supported||this.installing||this.state.status!=='downloaded')return false;
  this.installing=true;try{this.beforeInstall();this.updater.quitAndInstall(true,relaunch);return this.installing;}catch{this.fail();return false;}
 }
 stop(){if(this.timer)this.clearTimer(this.timer);this.timer=null;}
}
module.exports={Updates};
