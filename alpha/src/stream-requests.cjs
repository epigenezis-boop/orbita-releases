'use strict';
const superseded=()=>Error('[PLAYBACK_SUPERSEDED] Выбран другой трек');
class StreamRequests{
 constructor(resolve,{blocked=null,changed=()=>{},event=()=>{}}={}){this.fetch=resolve;this.active=null;this.pending=null;this.blocked=blocked;this.changed=changed;this.event=event;}
 request(id,quality){
  if(this.blocked){this.event('blocked');return Promise.reject(Error(this.blocked));}
  const key=id+':'+quality;
  if(this.pending?.key===key){this.event('shared');return this.pending.promise;}
  if(this.pending){this.pending.reject(superseded());this.pending=null;}
  if(this.active?.key===key){this.event('shared');return this.active.promise;}
  let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});
  const job={id,quality,key,promise,resolve,reject};
  if(this.active){this.pending=job;this.event('queued');}else this.start(job);
  return promise;
 }
 start(job){this.active=job;this.event('issued');Promise.resolve().then(()=>this.fetch(job.id,job.quality)).then(job.resolve,error=>{
  if(/\[DEVICE_LIMIT\//.test(error.message)){this.blocked=error.message;this.changed(this.blocked);}
  job.reject(error);
 }).finally(()=>{this.active=null;const next=this.pending;this.pending=null;if(next){if(this.blocked)next.reject(Error(this.blocked));else this.start(next);}});}
 cancelPending(){if(this.pending){this.pending.reject(superseded());this.pending=null;}}
 unblock(){this.blocked=null;this.changed(null);this.event('manual-unblock');}
}
module.exports={StreamRequests};
