'use strict';
// Only fixed markers leave the body parser. Never export page text or signed URLs.
async function responseDetails(r,url){
 const d={};try{d.host=new URL(url).hostname;d.finalHost=new URL(r.url||url).hostname;}catch{}
 d.redirected=!!r.redirected;
 for(const [header,key] of [['server','server'],['via','via'],['x-request-id','requestId'],['content-length','contentLength']]){const v=r.headers.get(header);if(v&&/^[a-zA-Z0-9_.: /()-]{1,120}$/.test(v))d[key]=v;}
 if(r.ok||!r.body)return d;
 const reader=r.body.getReader(),parts=[];let bytes=0,timer;
 try{await Promise.race([(async()=>{while(bytes<16384){const x=await reader.read();if(x.done)break;const p=x.value.subarray(0,16384-bytes);parts.push(p);bytes+=p.length;}})(),new Promise(resolve=>{timer=setTimeout(resolve,750);})]);}catch{}finally{clearTimeout(timer);reader.cancel().catch(()=>{});}
 const text=Buffer.concat(parts.map(p=>Buffer.from(p))).toString('utf8').toLowerCase();
 d.sampleBytes=bytes;
 d.markers=[['kaspersky',/kaspersky|касперск/],['nginx',/nginx/],['cloudflare',/cloudflare/],['captcha',/captcha|капч/],['access-denied',/access denied|доступ запрещ/],['request-blocked',/request blocked|запрос заблок/],['client-closed',/client closed request/],['expired',/expired|ист[её]к/],['invalid-signature',/invalid signature|signature mismatch/],['proxy',/proxy/],['html',/<html|<!doctype html/]].filter(([,re])=>re.test(text)).map(([name])=>name);
 return d;
}
module.exports={responseDetails};
