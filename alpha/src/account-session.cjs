'use strict';
// Account operations are user initiated or restore an existing saved token.
// No login, token refresh, cookie deletion or device registration is attempted here.
class AccountSession {
 constructor({api,stored,save,clear,resume=()=>{},changed=()=>{}}){Object.assign(this,{api,stored,save,clear,resume,changed});this.profile=null;this.restoreError=null;this.tail=Promise.resolve();this.connecting=null;}
 serial(fn){const task=this.tail.then(fn);this.tail=task.catch(()=>{});return task;}
 restore(){if(this.restoring)return this.restoring;const task=this.serial(async()=>{if(this.profile&&this.api.token)return this.profile;if(this.restoreError)throw this.restoreError;const token=this.stored();if(!token)return null;try{this.profile=await this.api.profile(token);return this.profile;}catch(e){if(/^\[(?:AUTH_|API_HTML\])/.test(e.message))this.restoreError=e;throw e;}});this.restoring=task;task.finally(()=>{if(this.restoring===task)this.restoring=null;}).catch(()=>{});return task;}
 connect(token){
  if(this.connecting){if(this.connecting.token===token)return this.connecting.task;return Promise.reject(Error('[AUTH_BUSY] Дождитесь завершения подключения.'));}
  const task=this.serial(async()=>{this.restoreError=null;this.resume();const previous=this.api.token;let p;try{p=await this.api.profile(token);await this.save();}catch(e){this.api.token=previous;throw e;}this.profile=p;this.changed();return p;});
  this.connecting={token,task};task.finally(()=>{if(this.connecting?.task===task)this.connecting=null;}).catch(()=>{});return task;
 }
 logout(){return this.serial(async()=>{await this.clear();this.profile=null;this.restoreError=null;this.changed();});}
}
module.exports={AccountSession};
