let currentTrackId='';
const $=id=>document.getElementById(id);const time=n=>Number.isFinite(n)&&n>=0?Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0'):'0:00';
for(const [id,action] of Object.entries({expand:'expand',hide:'hide',prev:'prev',next:'next',play:'toggle'}))$(id).onclick=()=>window.mini.action(action);
$('seek').oninput=e=>window.mini.action('seek',Number(e.target.value));$('volume').oninput=e=>window.mini.action('volume',Number(e.target.value));
$('like').onclick=()=>{if(!$('like').disabled){$('like').disabled=true;window.mini.action('like',currentTrackId);}};
let seeking=false;let lastState;function renderMini(s){lastState=s;currentTrackId=s.trackId||'';$('like').hidden=!s.canLike;$('like').disabled=!s.canLike||s.likePending;$('like').textContent=s.liked?'♥':'♡';$('like').setAttribute('aria-pressed',String(!!s.liked));$('like').setAttribute('aria-label',s.liked?OrbitaI18n.t('Убрать из любимых'):OrbitaI18n.t('Добавить в любимые'));$('title').textContent=s.title||OrbitaI18n.t('Твоя музыка рядом');$('artist').textContent=s.artist||OrbitaI18n.t('Выбери трек в основном окне');setPlayIcon(s.paused);$('elapsed').textContent=time(s.time);$('duration').textContent=time(s.duration);if(!seeking)$('seek').value=s.duration?s.time/s.duration:0;$('volume').value=s.volume;if(s.cover!==undefined){const cover=s.cover||'icon.png';if($('cover').getAttribute('src')!==cover)$('cover').src=cover;}}window.mini.onState(renderMini);window.addEventListener('orbita-language',()=>{if(lastState)renderMini(lastState);else setPlayIcon(true);});$('cover').onerror=()=>{$('cover').src='icon.png';};

window.mini.onTheme(t=>document.documentElement.dataset.theme=t);

function setPlayIcon(paused){
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
 const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paused?'M7 3 22 12 7 21Z':'M5 3h5v18H5z M14 3h5v18h-5z');svg.append(path);$('play').replaceChildren(svg);$('play').setAttribute('aria-label',paused?OrbitaI18n.t('Воспроизвести'):OrbitaI18n.t('Пауза'));
}
setPlayIcon(true);
const spectrumBars=Array.from({length:24},()=>{const b=document.createElement('i');$('miniSpectrum').append(b);return b;});
window.mini.onSpectrum?.(levels=>{spectrumBars.forEach((b,i)=>b.style.height=(2+Math.round((levels[i]||0)*23/255))+'px');});

$('seek').addEventListener('pointerdown',()=>{seeking=true;});
const endSeek=()=>{seeking=false;};
window.addEventListener('pointerup',endSeek);window.addEventListener('pointercancel',endSeek);window.addEventListener('blur',endSeek);
$('seek').addEventListener('change',endSeek);
for(const id of ['volume','seek'])$(id).addEventListener('wheel',e=>{
 if(!e.deltaY)return;e.preventDefault();const direction=e.deltaY<0?1:-1;
 if(id==='seek'&&!(lastState?.duration>0))return;
 const value=Math.max(0,Math.min(1,Number($(id).value)+direction*(id==='volume'?.05:5/lastState.duration)));
 $(id).value=value;window.mini.action(id==='volume'?'volume':'seek',value);
 if(id==='seek')$('elapsed').textContent=time(value*lastState.duration);
},{passive:false});
