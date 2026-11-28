'use strict';
const valid=v=>typeof v==='string'&&/^[\x21-\x7e]{1,256}$/.test(v);
const read=(headers,name)=>Object.entries(headers||{}).find(([k])=>k.toLowerCase()===name)?.[1];
const NEED='[SITE_IDENTITY_REQUIRED] Открой сайт Звука через настройки Orbita и дождись загрузки. Это нужно для чтения существующей идентификации устройства; повторный вход не требуется. Затем нажми «Повторить проверку аудио» и включи трек.';
class SiteIdentity{
 constructor({load=()=>null,save=()=>{},event=()=>{}}={}){this.save=save;this.event=event;try{this.value=load();}catch{this.value=null;}}
 observe(headers){
  const device=read(headers,'x-device-id'),instance=read(headers,'x-app-instance');
  const cookies=String(read(headers,'cookie')||'').split(';').map(x=>x.trim());
  const devices=cookies.filter(x=>x.startsWith('device_id=')).map(x=>x.slice(10));
  if(!valid(device)||!valid(instance)||devices.length!==1||devices[0]!==device)return;
  if(this.value?.device===device&&this.value?.instance===instance)return;
  this.value={device,instance};try{this.save(this.value);}catch{this.event('save-failed');}this.event('observed');
 }
 async headers(web,required=false){
  const cookies=await web.cookies.get({url:'https://zvuk.com/api/v1/graphql',name:'device_id'});
  const v=this.value;
  if(!v||!valid(v.device)||!valid(v.instance)||cookies.length!==1||cookies[0].value!==v.device){
   if(required){this.event('missing');throw Error(NEED);}return {};
  }
  this.event('reused');return {'X-Device-Id':v.device,'X-App-Instance':v.instance};
 }
 clear(){this.value=null;this.save(null);}
}
module.exports={SiteIdentity};
