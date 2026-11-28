'use strict';
(()=>{
 const api=window.desktop||window.settings||window.mini,I=OrbitaI18n;I.setLanguage(api?.language==='en'?'en':'ru');
 const texts=[],attrs=[];const walk=document.createTreeWalker(document.documentElement,NodeFilter.SHOW_TEXT);
 while(walk.nextNode()){const n=walk.currentNode;if(n.parentElement?.closest('script,style,[data-no-i18n]'))continue;const key=n.nodeValue.trim();if(I.catalog[key])texts.push({node:n,key,leading:n.nodeValue.match(/^\s*/)[0],trailing:n.nodeValue.match(/\s*$/)[0],last:n.nodeValue});}
 for(const e of document.querySelectorAll('*'))for(const name of ['title','aria-label','placeholder','alt']){const key=e.getAttribute(name);if(key&&I.catalog[key])attrs.push({e,name,key,last:key});}
 function apply(){document.documentElement.lang=I.getLanguage();for(const x of texts)if(x.node.isConnected&&x.node.nodeValue===x.last)x.node.nodeValue=x.last=x.leading+I.t(x.key)+x.trailing;for(const x of attrs)if(x.e.isConnected&&x.e.getAttribute(x.name)===x.last)x.e.setAttribute(x.name,x.last=I.t(x.key));}
 apply();api?.onLanguage?.(language=>{I.setLanguage(language);apply();window.dispatchEvent(new CustomEvent('orbita-language',{detail:language}));});
})();
