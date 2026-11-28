'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),{Readable}=require('node:stream'),path=require('node:path'),crypto=require('node:crypto');
const {audioURL}=require('./audio-url.cjs');
const CORS={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,HEAD,OPTIONS','Access-Control-Allow-Headers':'Range','Access-Control-Expose-Headers':'Content-Length,Content-Range,Accept-Ranges'};
const MIME={'.mp3':'audio/mpeg','.flac':'audio/flac','.wav':'audio/wav','.ogg':'audio/ogg','.opus':'audio/ogg','.m4a':'audio/mp4','.aac':'audio/aac','.webm':'audio/webm'};
function parseRange(value,size){if(!value)return null;const m=/^bytes=(\d*)-(\d*)$/.exec(value);if(!m||(!m[1]&&!m[2]))throw Error('range');let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2]));let end=m[1]?(m[2]?Number(m[2]):size-1):size-1;end=Math.min(end,size-1);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>end||start>=size)throw Error('range');return {start,end};}
async function localResponse(file,request){let stat;try{stat=await fsp.stat(file);}catch{return new Response('Файл недоступен',{status:404,headers:CORS});}if(!stat.isFile())return new Response(null,{status:404,headers:CORS});let range;try{range=parseRange(request.headers.get('range'),stat.size);}catch{return new Response(null,{status:416,headers:{...CORS,'Content-Range':'bytes */'+stat.size}});}const start=range?.start||0,end=range?.end??stat.size-1;const headers={...CORS,'Content-Type':MIME[path.extname(file).toLowerCase()]||'application/octet-stream','Accept-Ranges':'bytes','Content-Length':String(range?end-start+1:stat.size)};if(range)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;
 if(request.method==='HEAD'||!stat.size)return new Response(null,{status:range?206:200,headers});const stream=fs.createReadStream(file,{start,end});request.signal?.addEventListener('abort',()=>stream.destroy(),{once:true});return new Response(Readable.toWeb(stream),{status:range?206:200,headers});}
class MediaBroker{
 constructor(library,fetch,onStatus=()=>{},timeoutMs=20000){this.library=library;this.fetch=fetch;this.onStatus=onStatus;this.timeoutMs=timeoutMs;this.remote=new Map();this.active=new Set();}
 stopRemote(){for(const entry of [...this.active])entry.cancel();this.remote.clear();}
 issue(url,{expire,renew}={}){const u=audioURL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Некорректный поток');this.stopRemote();const token=crypto.randomUUID();this.remote.set(token,{url,expire,renew,renewing:null,renewed:false});if(this.remote.size>100)this.remote.delete(this.remote.keys().next().value);return 'volna-media://remote/'+token;}
 local(id){if(!this.library.get(id))throw Error('Трек отсутствует в медиатеке');return 'volna-media://local/'+id;}
 async handle(request){
  let entry;
  try{
   if(request.method==='OPTIONS')return new Response(null,{status:204,headers:CORS});
   if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:CORS});
   const url=new URL(request.url),id=url.pathname.slice(1);
   if(url.hostname==='cover'){const file=this.library.coverPath?.(id);if(!file)return new Response(null,{status:404,headers:CORS});try{const bytes=await fsp.readFile(file);if(bytes.length>1024*1024)return new Response(null,{status:404,headers:CORS});return new Response(request.method==='HEAD'?null:bytes,{headers:{...CORS,'Content-Type':bytes[0]===137?'image/png':bytes.toString('ascii',0,4)==='RIFF'?'image/webp':'image/jpeg','Cache-Control':'private, max-age=86400','X-Content-Type-Options':'nosniff'}});}catch{return new Response(null,{status:404,headers:CORS});}}
   if(url.hostname==='local'){const t=this.library.get(id);return t?localResponse(t.path,request):new Response(null,{status:404,headers:CORS});}
   if(url.hostname!=='remote'||!this.remote.has(id))return new Response(null,{status:404,headers:CORS});
   const remote=this.remote.get(id);
   const renew=async()=>{if(remote.renewing){await remote.renewing;return true;}if(!remote.renew||remote.renewed)return false;remote.renewed=true;remote.renewing=Promise.resolve().then(remote.renew).then(value=>{if(this.remote.get(id)!==remote)throw Error('Superseded');const u=audioURL(value.url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Invalid stream');remote.url=u.href;remote.expire=value.expire;});await remote.renewing;return true;};
   const numeric=Number(remote.expire),expires=Number.isFinite(numeric)&&numeric>1e9?(numeric<1e12?numeric*1000:numeric):Date.parse(remote.expire);
   if(Number.isFinite(expires)&&expires<=Date.now()+5000)await renew();
   const range=request.headers.get('range'),controller=new AbortController();let reader,finished=false,timeout=false,timer;
   const cleanup=()=>{clearTimeout(timer);request.signal?.removeEventListener('abort',abort);this.active.delete(entry);};
   const cancel=()=>{if(finished)return;finished=true;controller.abort();if(reader)reader.cancel().catch(()=>{});cleanup();};
   const abort=()=>cancel();entry={cancel};this.active.add(entry);
   request.signal?.addEventListener('abort',abort,{once:true});
   if(request.signal?.aborted){cancel();return new Response(null,{status:499,headers:CORS});}
   timer=setTimeout(()=>{timeout=true;controller.abort();},this.timeoutMs);
   let r;try{r=await this.fetch(remote.url,{method:request.method,credentials:'omit',headers:range?{Range:range}:{},signal:controller.signal});}
   catch(error){if(!finished)this.onStatus({url:request.url,code:timeout?'MEDIA_TIMEOUT':'MEDIA_NETWORK'});cancel();throw error;}
   if([403,410].includes(r.status)&&remote.renew&&!remote.renewed){await r.body?.cancel();await renew();r=await this.fetch(remote.url,{method:request.method,credentials:'omit',headers:range?{Range:range}:{},signal:controller.signal});}
   clearTimeout(timer);
   if(finished){await r.body?.cancel();return new Response(null,{status:499,headers:CORS});}
   this.onStatus({url:request.url,code:'MEDIA_RESPONSE',status:r.status});
   if(!r.ok)this.onStatus({url:request.url,code:'MEDIA_HTTP_'+r.status});
   if(r.ok&&/text\/html/i.test(r.headers.get('content-type')||'')){this.onStatus({url:request.url,code:'MEDIA_HTML'});await r.body?.cancel();cancel();return new Response(null,{status:502,headers:CORS});}
   const headers=new Headers(CORS);for(const h of ['content-type','content-length','content-range','accept-ranges'])if(r.headers.has(h))headers.set(h,r.headers.get(h));
   if(request.method==='HEAD'||!r.body){await r.body?.cancel();finished=true;cleanup();return new Response(null,{status:r.status,headers});}
   reader=r.body.getReader();
   const body=new ReadableStream({
    pull:async sink=>{try{let idle;const part=await Promise.race([reader.read(),new Promise((_resolve,reject)=>{idle=setTimeout(()=>{if(!finished)this.onStatus({url:request.url,code:'MEDIA_STALL'});reject(Error('Audio idle timeout'));cancel();},this.timeoutMs);})]).finally(()=>clearTimeout(idle));if(part.done){finished=true;cleanup();sink.close();}else sink.enqueue(part.value);}catch(error){if(!finished)this.onStatus({url:request.url,code:'MEDIA_BODY_ERROR'});cancel();sink.error(error);}},
    cancel:()=>cancel()
   });
   return new Response(body,{status:r.status,headers});
  }catch{entry?.cancel();return new Response('Поток недоступен',{status:502,headers:CORS});}
 }

}
module.exports={MediaBroker,localResponse,parseRange};
