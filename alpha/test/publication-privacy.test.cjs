'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('publication source excludes profile files and credential signatures',()=>{
 const root=path.join(__dirname,'..');const forbidden=/^(?:account\.bin|orbita-site-identity\.bin|Cookies|Login Data|Local State|\.env(?:\..*)?|.*\.(?:pfx|p12|pem|sqlite3?|db))$/i;
 const secret=/(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
 function scan(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['node_modules','.git','dist'].includes(entry.name))continue;const file=path.join(dir,entry.name);assert.ok(!forbidden.test(entry.name),'Profile or secret file in publication: '+path.relative(root,file));if(entry.isDirectory())scan(file);else if(/\.(?:cjs|js|json|html|css|md|txt)$/.test(entry.name))assert.ok(!secret.test(fs.readFileSync(file,'utf8')),'Credential signature in '+path.relative(root,file));}}
 scan(root);
});
