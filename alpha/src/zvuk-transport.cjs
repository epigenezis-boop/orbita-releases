'use strict';
const {audioURL}=require('./audio-url.cjs');
const {responseDetails}=require('./response-diagnostics.cjs');
const CHALLENGE='[API_HTML] Звук запросил проверку сайта. Откройте сайт в настройках Orbita, пройдите капчу и нажмите «Подключить сессию». Повторно входить или выходить из аккаунта для этого не нужно.';
class ZvukTransport {
 constructor(web,identity=null,event=()=>{}){this.web=web;this.identity=identity;this.event=event;this.blocked=false;}
 resume(){this.blocked=false;}
 async audio(url,opts={}){
  let u=audioURL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Некорректный адрес аудио');
  const range=new Headers(opts.headers).get('range');
  const started=Date.now();let r;try{for(let hop=0;hop<6;hop++){r=await this.web.fetch(u.href,{redirect:'manual',method:opts.method==='HEAD'?'HEAD':'GET',credentials:'include',signal:opts.signal,headers:{Referer:'https://zvuk.com/',...(range?{Range:range}:{})}});if(![301,302,303,307,308].includes(r.status))break;const location=r.headers.get('location');await r.body?.cancel();if(!location||hop===5)throw Error('Invalid audio redirect');u=audioURL(new URL(location,u).href);}}catch(e){this.event({source:'account-session',operation:'audio',stage:'network-error',error:e.name,host:u.hostname,durationMs:Date.now()-started});throw e;}
  const type=(r.headers.get('content-type')||'').split(';')[0];const extra=await responseDetails(r.ok?r:r.clone(),u.href);this.event({...extra,durationMs:Date.now()-started,endpoint:'signed-audio-url',source:'account-session',operation:'audio',status:r.status,stage:/^[a-zA-Z0-9.+/-]{1,80}$/.test(type)?type:'unknown',headers:[...r.headers.keys()]});return r;
 }
 async request(route,body,token){
  if(this.blocked)throw Error(CHALLENGE);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
   const identity=this.identity?await this.identity.headers(this.web,/^query getStream\b/.test(body?.query||'')):{};
   const r=await this.web.fetch('https://zvuk.com'+route,{method:body?'POST':'GET',credentials:'include',cache:'no-store',redirect:'error',signal:controller.signal,headers:{...identity,Accept:'application/graphql-response+json, application/json','X-App-Name':'web-zvuk-service-desktop-app',Referer:'https://zvuk.com/',...(body?{'Content-Type':'application/json'}:{}),...(token?{'X-Auth-Token':token}:{})},body:body?JSON.stringify(body):undefined});
   this.event({...await responseDetails(r.ok?r:r.clone(),'https://zvuk.com'+route),source:'account-session',operation:'api',endpoint:route,status:r.status,headers:[...r.headers.keys()]});
   const type=r.headers.get('content-type')||'';
   if(/text\/html/i.test(type)||r.ok&&!type.includes('json')){this.blocked=true;throw Error(CHALLENGE);}
   if(!r.ok)throw Error('[HTTP_'+r.status+'] Звук отклонил запрос. '+([401,403].includes(r.status)?'Сессия не подтверждена. Проверьте доступ через настройки Orbita.':'Повторите запрос позже.'));
   return await r.json();
  }catch(e){if(e.name==='AbortError')throw Error('[NETWORK_TIMEOUT] Звук не ответил за 20 секунд. Проверьте подключение.');if(e.message.startsWith('['))throw e;throw Error('[NETWORK_FAILED] Не удалось подключиться к Звуку. Проверьте сеть.');}
  finally{clearTimeout(timer);}
 }
}
module.exports={ZvukTransport};
