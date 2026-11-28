'use strict';
function applyTheme(t){document.documentElement.dataset.theme=t;}
window.desktop.onTheme?.(applyTheme);call('theme-get').then(applyTheme).catch(()=>{});
window.desktop.onAccountChanged?.(async()=>{try{const p=await call('restore');sessionTicket++;detailHistory.length=0;account(p);likedIds=[];likedTracks=[];likedOffset=0;if(p)await sync();else{stopWave();playTicket++;audio.pause();audio.removeAttribute('src');audio.load();queue=[];queueOrder.reset();index=-1;visible=[];updateQueue();$('playlists').replaceChildren();$('nowTitle').textContent=OrbitaI18n.t('Выбери, что послушать');$('nowArtist').textContent='';render();}}catch(e){notice(e.message);}});
const symbols={prev:'M15 5 7 12l8 7V5z M4 5v14',next:'m9 5 8 7-8 7V5z M20 5v14',shuffle:'M3 6h3l12 12h3 M17 14l4 4-4 4 M3 18h3l4-4 M14 10l4-4h3 M17 2l4 4-4 4',repeat:'M5 7h12l-3-3 M19 17H7l3 3 M19 7a7 7 0 0 1 0 7 M5 17a7 7 0 0 1 0-7'};
for(const [id,d] of Object.entries(symbols)){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',d);svg.append(p);$(id).replaceChildren(svg);}
const canvas=$('visualizer'),ctx=canvas.getContext('2d');let analyser,data,last=0;
const observer=new ResizeObserver(()=>{const r=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio,2);canvas.width=Math.round(r.width*d);canvas.height=Math.round(r.height*d);});observer.observe(canvas);
function draw(ts){requestAnimationFrame(draw);if(ts-last<32||document.hidden)return;last=ts;if(equalizer.limiter&&!analyser){analyser=equalizer.context.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=.8;equalizer.limiter.connect(analyser);data=new Uint8Array(analyser.frequencyBinCount);}const w=canvas.width,h=canvas.height;ctx.clearRect(0,0,w,h);const colors=getComputedStyle(document.documentElement);const accent=colors.getPropertyValue('--teal').trim()||'#59d4c5';ctx.fillStyle=accent;ctx.globalAlpha=.16;for(let x=8;x<w;x+=16)ctx.fillRect(x,h*.84,3,2);ctx.globalAlpha=1;if(analyser)analyser.getByteFrequencyData(data);const bars=48,gap=4,bar=Math.max(2,(w-32)/bars-gap);for(let i=0;i<bars;i++){const v=analyser&&!audio.paused?data[Math.min(data.length-1,Math.floor(Math.pow(i/(bars-1),1.9)*300))]/255:0;const height=Math.max(3,v*(h-12));ctx.fillStyle=i<16?accent:i<32?colors.getPropertyValue('--orange'):colors.getPropertyValue('--cream');for(let y=0;y<height;y+=7)ctx.fillRect(16+i*(bar+gap),h-8-y,bar,4);} }
requestAnimationFrame(draw);

function settingsButton(){const b=$('accountBtn');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d','m9 3 .7-2h4.6l.7 2 2 .9 2.1-.3 2.3 4-1.4 1.7v2.4l1.4 1.7-2.3 4-2.1-.3-2 .9-.7 2H9l-.7-2-2-.9-2.1.3-2.3-4 1.4-1.7V9.3L1.9 7.6l2.3-4 2.1.3L9 3Z');const circle=document.createElementNS(svg.namespaceURI,'circle');circle.setAttribute('cx','11.3');circle.setAttribute('cy','10.5');circle.setAttribute('r','3.4');svg.append(path,circle);b.replaceChildren(svg,element('span','',OrbitaI18n.t('Настройки')));}
settingsButton();
function waveGlyph(){
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 40 34');svg.setAttribute('class','waveGlyph sunsetGlyph');svg.setAttribute('aria-hidden','true');
 const shape=(d,cls)=>{const p=document.createElementNS(ns,'path');p.setAttribute('d',d);p.setAttribute('class',cls);svg.append(p);};
 shape('M7 19a13 13 0 0 1 26 0Z','sunTop');
 shape('M9 12h22v3H9z M7 17h26v2H7z','sunStripes');
 for(const d of ['M3 21q8-2 17 0t17 0','M6 26q7-2 14 0t14 0','M11 31q5-2 9 0t9 0'])shape(d,'sunWaves');
 return svg;
}
$('waveNav').replaceChildren(waveGlyph(),element('span','',OrbitaI18n.t('Мой поток')));

// Audio stays in the main renderer. The widget receives only 24 FFT magnitudes.
setInterval(()=>{
 if(equalizer.limiter&&!analyser){analyser=equalizer.context.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=.8;equalizer.limiter.connect(analyser);data=new Uint8Array(analyser.frequencyBinCount);}
 const levels=Array(24).fill(0);
 if(analyser&&!audio.paused){analyser.getByteFrequencyData(data);for(let i=0;i<24;i++)levels[i]=data[Math.min(data.length-1,Math.floor(Math.pow(i/23,1.9)*300))];}
 window.desktop.publishSpectrum?.(levels);
},100);

function stationGlyph(kind){
 const ns='http://www.w3.org/2000/svg',s=document.createElementNS(ns,'svg');s.setAttribute('viewBox','0 0 32 32');s.setAttribute('class','stationGlyph');s.setAttribute('aria-hidden','true');
 const path=(d,cls='')=>{const p=document.createElementNS(ns,'path');p.setAttribute('d',d);if(cls)p.setAttribute('class',cls);s.append(p);};
 if(kind==='flow'){path('M6 16a10 10 0 0 1 20 0Z','iconSun');path('M3 19q6-2 13 0t13 0 M5 23q5-2 11 0t11 0 M9 27q4-2 7 0t7 0');}
 if(kind==='favorites'){path('M16 26S4 18 4 11a6 6 0 0 1 12-2 6 6 0 0 1 12 2c0 7-12 15-12 15Z');path('m26 2 1.2 3.8L31 7l-3.8 1.2L26 12l-1.2-3.8L21 7l3.8-1.2Z','iconSpark');}
 if(kind==='library'){path('M5 11h22v15a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z');path('M3 11h26L26 5H6Z','iconAccent');path('M14 23V15l8-2v8 M14 20c-5-2-5 5 0 3 M22 18c-5-2-5 5 0 3','iconTeal');}
 if(kind==='queue'){for(const y of [8,16,24]){path(`M11 ${y}h14q5 0 3 3H11`,'iconAccent');const c=document.createElementNS(ns,'circle');c.setAttribute('cx','5');c.setAttribute('cy',y+1);c.setAttribute('r','2');c.setAttribute('class','iconSpark');s.append(c);}}
 return s;
}
function paintNavigation(){for(const [id,kind,key]of [['waveNav','flow','Мой поток'],['liked','favorites','Любимые треки'],['localNav','library','Библиотека ПК'],['queueNav','queue','Очередь']]){const b=$(id),count=b.querySelector('small');b.replaceChildren(stationGlyph(kind),element('span','',OrbitaI18n.t(key)));if(count)b.append(count);}}
paintNavigation();
