'use strict';
(function(root){
 const normalize=p=>String(p||'').replace(/\\/g,'/').replace(/\/+$/,'');
 const inside=(folder,parent)=>{const f=normalize(folder).toLocaleLowerCase('ru'),p=normalize(parent).toLocaleLowerCase('ru');return f===p||f.startsWith(p+'/');};
 function build(tracks){const root={children:new Map(),count:0},nodes=new Map();for(const t of tracks){const original=t.folder||'Без папки',normalized=normalize(original);let current=root,full=normalized.startsWith('//')?'//':normalized.startsWith('/')?'/':'';const parts=normalized.split('/').filter(Boolean);root.count++;for(const name of parts){full=full==='/'||full==='//'?full+name:full?full+'/'+name:name;const key=full.toLocaleLowerCase('ru');let node=current.children.get(key);if(!node){node={name,path:full,key,count:0,children:new Map()};current.children.set(key,node);nodes.set(key,node);}node.count++;current=node;}}
 const sort=node=>{node.children=[...node.children.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}));node.children.forEach(sort);};sort(root);
 // Skip uninformative single-child ancestors, keeping the complete path in node.path.
 let roots=root.children;while(roots.length===1&&roots[0].children.length===1&&roots[0].count===roots[0].children[0].count)roots=roots[0].children;
 return {roots,nodes,count:root.count};}
 const api={build,inside,normalize};if(typeof module!=='undefined')module.exports=api;else root.OrbitaFolders=api;
})(globalThis);
