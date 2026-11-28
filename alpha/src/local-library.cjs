'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const EXT=new Set(['.mp3','.flac','.wav','.ogg','.opus','.m4a','.aac','.webm']);
const key=p=>process.platform==='win32'?p.toLowerCase():p;
class LocalLibrary{
 constructor(file,progress=()=>{},resize=b=>b){this.file=file;this.progress=progress;this.resize=resize;this.covers=path.join(path.dirname(file),'covers');this.items=[];this.busy=false;this.tail=Promise.resolve();this.coverCache=new Map();}
 serial(fn){const task=this.tail.then(fn);this.tail=task.catch(()=>{});return task;}
 async cover(data,type){if(!Buffer.isBuffer(data)||data.length>1024*1024||!['image/jpeg','image/png','image/webp'].includes(type))return '';const inputHash=crypto.createHash('sha256').update(data).digest('hex');if(this.coverCache.has(inputHash))return this.coverCache.get(inputHash);const image=await this.resize(data,type);if(!image||image.length>1024*1024)return '';const hash=crypto.createHash('sha256').update(image).digest('hex');await fs.mkdir(this.covers,{recursive:true});await fs.writeFile(path.join(this.covers,hash),image);const url='volna-media://cover/'+hash;this.coverCache.set(inputHash,url);return url;}
 coverPath(id){return /^[a-f0-9]{64}$/.test(id)?path.join(this.covers,id):null;}
 async load(){try{const d=JSON.parse(await fs.readFile(this.file,'utf8'));this.items=Array.isArray(d.items)?d.items.filter(t=>typeof t.path==='string'&&/^local-[\w-]+$/.test(t.id)):[];}catch{this.items=[];}let migrated=false;for(const t of this.items){const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(t.cover||'');if(m){try{t.cover=await this.cover(Buffer.from(m[2],'base64'),m[1]);migrated=true;}catch{}}}if(migrated)try{await this.save();}catch{}return this.list();}
 list(){return this.items.map(({path: file,...t})=>({...t,folder:path.dirname(file)}));}
 get(id){return this.items.find(t=>t.id===id);}
 async save(){await fs.mkdir(path.dirname(this.file),{recursive:true});await fs.writeFile(this.file+'.tmp',JSON.stringify({items:this.items}),{mode:0o600});await fs.rename(this.file+'.tmp',this.file);}
 add(paths){return this.serial(()=>this.addNow(paths));}
 async addNow(paths){
 if(this.busy)throw Error('Дождитесь завершения текущего добавления.');this.busy=true;const previous=[...this.items];let added=0,skipped=0,failed=0;
 try{const {parseFile,selectCover}=await import('music-metadata');const known=new Set(this.items.map(t=>key(t.path)));const pending=[...paths];let checked=0;
 while(pending.length){const p=pending.pop();let stat;try{stat=await fs.lstat(p);}catch{failed++;continue;}if(stat.isSymbolicLink()){skipped++;continue;}if(stat.isDirectory()){try{const children=await fs.readdir(p);pending.push(...children.map(x=>path.join(p,x)));}catch{failed++;}continue;}if(!stat.isFile()||!EXT.has(path.extname(p).toLowerCase()))continue;
 let real;try{real=await fs.realpath(p);}catch{failed++;continue;}if(known.has(key(real))){skipped++;continue;}
 let common={},format={},art='';try{const m=await parseFile(real,{duration:true,skipCovers:false});common=m.common;format=m.format;const pic=selectCover(common.picture);if(pic&&pic.data.length<=1024*1024&&['image/jpeg','image/png','image/webp'].includes(pic.format))art=await this.cover(Buffer.from(pic.data),pic.format);}catch{failed++;}
 this.items.push({id:'local-'+crypto.randomUUID(),source:'local',path:real,title:common.title||path.basename(real,path.extname(real)),artist:common.artist||'Неизвестный исполнитель',album:common.album||path.basename(path.dirname(real)),duration:Number(format.duration)||0,cover:art,format:path.extname(real).slice(1).toUpperCase(),fileName:path.basename(real)});known.add(key(real));added++;checked++;if(checked%10===0){this.progress({added,skipped,failed});await new Promise(r=>setImmediate(r));}
 }
 await this.save();this.progress({added,skipped,failed,done:true});return {items:this.list(),added,skipped,failed};
 }catch(e){this.items=previous;throw e;}finally{this.busy=false;}}
 remove(id){return this.serial(async()=>{const previous=this.items;this.items=this.items.filter(t=>t.id!==id);try{await this.save();}catch(e){this.items=previous;throw e;}return this.list();});}
}
module.exports={LocalLibrary,EXT};
