'use strict';
const fs=require('node:fs'),path=require('node:path');
function profile(p){return p&&Number.isFinite(p.lufs)&&p.lufs>=-70&&p.lufs<=10&&Number.isFinite(p.peak)&&p.peak>0&&p.peak<=8&&Number.isFinite(p.seconds)&&p.seconds>=.4&&p.seconds<86400?{lufs:p.lufs,peak:p.peak,seconds:p.seconds}:null;}
class LoudnessStore{
 constructor(file,library){this.file=file;this.library=library;this.entries={};this.enabled=true;try{if(fs.statSync(file).size<8*1024*1024){const s=JSON.parse(fs.readFileSync(file,'utf8'));this.enabled=s.enabled!==false;for(const [id,e] of Object.entries(s.entries||{}))if(this.validId(id)&&profile(e.profile)&&typeof e.stamp==='string')this.entries[id]=e;}}catch{}}
 validId(id){return typeof id==='string'&&/^(?:local-[\w-]+|\d{1,24})$/.test(id);}
 save(){const keys=Object.keys(this.entries);while(keys.length>10000)delete this.entries[keys.shift()];fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({enabled:this.enabled,entries:this.entries}),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);}
 setEnabled(v){if(typeof v!=='boolean')throw Error('Некорректный переключатель');this.enabled=v;this.save();return v;}
 info(id){if(!this.validId(id))throw Error('Некорректный трек');const local=id.startsWith('local-');let stamp='stream-v2',eligible=false;if(local){const t=this.library.get(id);if(!t)return null;try{const s=fs.statSync(t.path);stamp='analysis-v2:'+s.size+':'+s.mtimeMs;eligible=s.isFile()&&s.size<=48*1024*1024&&t.duration>0&&t.duration<=600;}catch{return null;}}
 const entry=this.entries[id];return {duration:local?this.library.get(id)?.duration:null,stamp,profile:entry?.stamp===stamp?entry.profile:null,complete:entry?.stamp===stamp&&entry.complete===true,eligible};}
 put(id,stamp,p,complete){const info=this.info(id),safe=profile(p);if(!info||info.stamp!==stamp||!safe||typeof complete!=='boolean')return false;if(complete&&(!id.startsWith('local-')||!info.eligible))return false;const old=this.entries[id];if(old?.stamp===stamp&&old.complete&&!complete)return false;this.entries[id]={stamp,profile:safe,complete};this.save();return true;}
}
module.exports={LoudnessStore,profile};
