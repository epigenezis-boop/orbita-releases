(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./i18n-catalog.js'):root.OrbitaCatalog);if(typeof module==='object'&&module.exports)module.exports=api;else root.OrbitaI18n=api;})(typeof globalThis==='object'?globalThis:this,function(catalog){
 'use strict';let language='ru';const reverse=new Map(Object.entries(catalog).map(([ru,en])=>[en,ru]));
 function setLanguage(value){if(!['ru','en'].includes(value))throw Error('Invalid language');language=value;}
 function t(key){return language==='en'?(catalog[key]??key):key;}
 // Only call for interface messages, never for catalog or user metadata.
 function message(value){const s=String(value??'');if(language==='en'&&catalog[s])return catalog[s];if(language==='ru'&&reverse.has(s))return reverse.get(s);
  const map=language==='en'?Object.entries(catalog):[...reverse];
  for(const ru of ['Получение аудио: ','Подбор потока: ','Не удалось подключиться. ']){const en=catalog[ru];if(s.startsWith(ru)||s.startsWith(en))return t(ru)+message(s.slice(s.startsWith(ru)?ru.length:en.length));}
  const code=s.match(/^(\[[A-Z0-9_\/]+\]\s*)(.*)$/s);if(code)return code[1]+message(code[2]);
  const prefix=map.filter(([a])=>a.length>3&&(/[:：.]\s$/.test(a)||a==='АЛЬБОМ · '||a==='ALBUM · ')).sort((a,b)=>b[0].length-a[0].length).find(([a])=>s.startsWith(a));
  return prefix?prefix[1]+s.slice(prefix[0].length):s;
 }
 function count(n,unit){const plural=language==='en'?(n===1?'one':'other'):new Intl.PluralRules('ru').select(n);const forms=unit==='album'?{en:{one:'album',other:'albums'},ru:{one:'альбом',few:'альбома',many:'альбомов',other:'альбома'}}:{en:{one:'track',other:'tracks'},ru:{one:'трек',few:'трека',many:'треков',other:'трека'}};return n+' '+forms[language][plural];}
 return {t,message,count,setLanguage,getLanguage:()=>language,catalog};
});
