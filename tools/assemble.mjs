import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {listPackage,statFile,extractFile} from '@electron/asar';
const r=JSON.parse(fs.readFileSync('release.json','utf8'));
if(!/^\d+\.\d+\.\d+$/.test(r.version)||!Number.isInteger(r.parts)||r.parts<1||r.parts>100)throw Error('Invalid release manifest');
const bytes=Buffer.concat(Array.from({length:r.parts},(_,i)=>fs.readFileSync(`payload/app.asar.gz.part-${String(i).padStart(3,'0')}`)));
if(createHash('sha256').update(bytes).digest('hex')!==r.sha256)throw Error('Release payload SHA-256 mismatch');
fs.mkdirSync('staging',{recursive:true});const archive='staging/app.asar';fs.writeFileSync(archive,gunzipSync(bytes));
// Reinstall dependencies on Windows; never copy Linux npm .bin symlinks.
for(const entry of listPackage(archive)){
 const name=entry.replaceAll('\\','/').replace(/^\/+/, '');
 if(!['package.json','package-lock.json'].includes(name)&&!name.startsWith('src/')&&!name.startsWith('test/'))continue;
 const nativeName=name.split('/').join(path.sep);
 const stat=statFile(archive,nativeName,false);if(stat.files||stat.link)continue;
 const dest=path.resolve('app',name);if(!dest.startsWith(path.resolve('app')+path.sep))throw Error('Invalid archive path');
 fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,extractFile(archive,nativeName));
}
const p=JSON.parse(fs.readFileSync('app/package.json','utf8'));
if(p.version!==r.version||p.name!=='volna-player'||p.build.appId!=='Orbita.Player'||p.build.publish[0].repo!=='orbita-releases'||p.build.publish[0].owner!=='epigenezis-boop')throw Error('Wrong application or release version');
if(p.build.nsis.perMachine!==false||p.build.nsis.allowElevation!==false)throw Error('Per-user installation required');
console.log(`Verified Orbita ${p.version}; installation will not request elevation.`);
