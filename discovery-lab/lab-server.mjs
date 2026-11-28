import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const page=await readFile(path.join(root,'lab.html'),'utf8');
const nonce=randomBytes(24).toString('hex');
let active=null, origin='';
function reply(res,code,value){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req){let s='';for await(const chunk of req){s+=chunk;if(s.length>16000)throw Error('Request too large');}return JSON.parse(s);}
function runProbe(args,token,proxy,dir){
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[path.join(root,'listenbrainz-probe.mjs'),...args],{cwd:dir,windowsHide:true,env:{...process.env,LISTENBRAINZ_TOKEN:token,ORBITA_DISCOVERY_PROXY:proxy},stdio:['ignore','ignore','pipe']});
  active=child;let err='';
  child.stderr.on('data',d=>{if(err.length<4000)err+=d;});
  child.on('error',reject);child.on('close',code=>{active=null;code===0?resolve():reject(Error(err.trim().split('\n').at(-1)||'Probe stopped'));});
 });
}
function validate(p){if(!p||typeof p.token!=='string'||! /^[A-Za-z0-9_-]{1,256}$/.test(p.token))throw Error('Введите корректный токен ListenBrainz');
 if(!['easy','medium','hard'].includes(p.mode))throw Error('Некорректный режим');
 if(!Number.isInteger(p.count)||p.count<1||p.count>30)throw Error('Количество: 1–30');
 if(!Array.isArray(p.seeds)||p.seeds.length<1||p.seeds.length>4||p.seeds.some(x=>typeof x!=='string'||!x.trim()||x.length>120))throw Error('Укажите 1–4 исполнителей');
 if(typeof p.proxy!=='string'||(p.proxy&&!/^(?:http|socks5h):\/\/127\.0\.0\.1:\d{1,5}$/.test(p.proxy)))throw Error('Прокси: http://127.0.0.1:10809 или socks5h://127.0.0.1:10808');
}
let busy=false,cancelled=false;
const server=http.createServer(async(req,res)=>{
 if(req.headers.host!==new URL(origin).host){reply(res,403,{error:'Invalid host'});return;}
 if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"});res.end(page.replace('__NONCE__',nonce));return;}
 if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-orbita-nonce']!==nonce){reply(res,403,{error:'Forbidden'});return;}
 if(req.url==='/cancel'){cancelled=true;active?.kill();reply(res,200,{ok:true});return;}
 if(req.url!=='/discover'){reply(res,404,{error:'Not found'});return;}
 if(busy){reply(res,409,{error:'Поиск уже выполняется'});return;}
 busy=true;cancelled=false;let dir;
 try{
  const p=await body(req);validate(p);dir=await mkdtemp(path.join(tmpdir(),'orbita-discovery-'));
  const all=new Map(),errors=[];const per=Math.min(30,Math.max(3,Math.ceil(p.count/p.seeds.length)+3));
  for(let i=0;i<p.seeds.length&&!cancelled;i++){
   const name='result-'+i+'.json';
   try{await runProbe([p.seeds[i],p.mode,String(per),name],p.token,p.proxy,dir);
    const report=JSON.parse(await readFile(path.join(dir,name),'utf8'));
    for(const c of report.candidates){const old=all.get(c.recording_mbid);if(old){old.seeds.push(p.seeds[i]);}else all.set(c.recording_mbid,{...c,seeds:[p.seeds[i]],rating:null,zvuk_match_status:'not_checked'});}
   }catch(e){if(!cancelled)errors.push({seed:p.seeds[i],error:String(e.message).replaceAll(p.token,'[redacted]')});}
  }
  const groups=new Map();for(const c of [...all.values()].sort((a,b)=>b.seeds.length-a.seeds.length)){const k=c.artist_mbid;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(c);}
  const candidates=[];while(candidates.length<p.count&&[...groups.values()].some(g=>g.length)){for(const g of groups.values())if(g.length&&candidates.length<p.count)candidates.push(g.shift());}
  reply(res,200,{schema_version:1,generated_at:new Date().toISOString(),mode:p.mode,seeds:p.seeds,cancelled,errors,candidates});
 }catch(e){reply(res,400,{error:e.message});}finally{if(dir)await rm(dir,{recursive:true,force:true}).catch(()=>{});busy=false;}
});
server.listen(0,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;console.log('Orbita Discovery Lab: '+origin);if(process.platform==='win32'){const child=spawn('cmd.exe',['/d','/c','start','',origin],{windowsHide:true,stdio:'ignore'});child.on('error',()=>{});}});
process.on('SIGINT',()=>{active?.kill();server.close();process.exit(0);});
