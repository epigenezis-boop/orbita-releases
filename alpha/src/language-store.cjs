'use strict';
const fs=require('node:fs'),path=require('node:path');
class LanguageStore{
 constructor(file){this.file=file;this.value='ru';try{const v=JSON.parse(fs.readFileSync(file,'utf8')).language;if(['ru','en'].includes(v))this.value=v;}catch{}}
 set(value){if(!['ru','en'].includes(value))throw Error('Некорректный язык');fs.mkdirSync(path.dirname(this.file),{recursive:true});fs.writeFileSync(this.file+'.tmp',JSON.stringify({language:value}),{mode:0o600});fs.renameSync(this.file+'.tmp',this.file);this.value=value;return value;}
}
module.exports={LanguageStore};
