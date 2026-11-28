'use strict';
(()=>{const banner=document.getElementById('updateBanner'),text=document.getElementById('updateBannerText');
let last;const render=s=>{last=s;banner.hidden=!['available','downloaded'].includes(s.status);text.textContent=s.status==='downloaded'?'Orbita '+s.availableVersion+OrbitaI18n.t(' готова к установке при выходе.'):OrbitaI18n.t('Доступна новая Orbita ')+s.availableVersion+'.';};
window.addEventListener('orbita-language',()=>{if(last)render(last);});window.desktop.onUpdates?.(render);window.desktop.call('updates-get').then(r=>{if(r.ok)render(r.value);}).catch(()=>{});
document.getElementById('updateSettings').onclick=()=>window.desktop.call('settings-open').catch(()=>{});
})();
