'use strict';
// Signed audio URLs may use different public CDNs. Never fetch local addresses.
function audioURL(value){const u=new URL(value);const h=u.hostname.toLowerCase();if(u.protocol!=='https:'||u.username||u.password||h==='localhost'||h.endsWith('.localhost')||h.endsWith('.local')||h.endsWith('.internal')||h.endsWith('.home.arpa')||h.startsWith('['))throw Error('Некорректный адрес аудио');if(/^\d+\.\d+\.\d+\.\d+$/.test(h)){const [a,b]=h.split('.').map(Number);if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127)throw Error('Недопустимый адрес аудио');}return u;}
module.exports={audioURL};
