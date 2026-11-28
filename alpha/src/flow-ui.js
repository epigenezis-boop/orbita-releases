'use strict';
(()=>{
 const pad=$('moodPad'),point=$('moodPoint'),energy=$('waveEnergy'),fun=$('waveFun'),enabled=$('waveMood');
 function paint(){const p=OrbitaMood.toPoint(Number(energy.value),Number(fun.value));point.style.left='clamp(13px,'+(p.x*100)+'%,calc(100% - 13px))';point.style.top='clamp(13px,'+(p.y*100)+'%,calc(100% - 13px))';pad.dataset.enabled=String(enabled.checked);pad.setAttribute('aria-label',OrbitaI18n.t('Настроение музыки')+' · '+OrbitaI18n.t('Энергия')+': '+energy.value+' · '+OrbitaI18n.t('Веселье')+': '+fun.value);}
 function save(){try{localStorage.setItem('volna-wave-settings',JSON.stringify({mood:enabled.checked,energy:Number(energy.value),fun:Number(fun.value)}));}catch{}paint();}
 function choose(x,y){const v=OrbitaMood.fromPoint(x,y);energy.value=v.energy;fun.value=v.fun;enabled.checked=true;paint();}
 function pointer(e){const r=pad.getBoundingClientRect();choose((e.clientX-r.left)/r.width,(e.clientY-r.top)/r.height);}
 let dragging=false;
 pad.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();dragging=true;pad.setPointerCapture(e.pointerId);pad.focus({preventScroll:true});pointer(e);});
 pad.addEventListener('pointermove',e=>{if(dragging)pointer(e);});
 pad.addEventListener('pointerup',e=>{if(!dragging)return;pointer(e);dragging=false;if(pad.hasPointerCapture(e.pointerId))pad.releasePointerCapture(e.pointerId);save();});
 pad.addEventListener('pointercancel',()=>{dragging=false;save();});
 pad.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();const p=OrbitaMood.toPoint(Number(energy.value),Number(fun.value)),step=e.shiftKey?.1:.02;if(e.key==='Home'){energy.value=OrbitaMood.defaults.energy;fun.value=OrbitaMood.defaults.fun;enabled.checked=true;}else choose(p.x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),p.y+(e.key==='ArrowDown'?step:e.key==='ArrowUp'?-step:0));save();});
 for(const input of [energy,fun])input.addEventListener('input',()=>{enabled.checked=true;save();});enabled.addEventListener('change',save);
 $('waveReset').addEventListener('click',paint);window.addEventListener('orbita-language',paint);paint();
 // The whole scene uses one coordinate system, so wave-shaped sun cutouts stay aligned.
 const scene=$('sunsetScene'),paths=$('sunsetWavePaths'),mask=$('sunsetWavesMask');
 function sunset(){const r=$('wavePanel').getBoundingClientRect();if(!r.width||!r.height)return;const w=r.width,h=r.height,cx=w/2,cy=document.querySelector('.waveSettings').open?80:h/2,radius=58;scene.setAttribute('viewBox',`0 0 ${w} ${h}`);mask.setAttribute('width',w);mask.setAttribute('height',h);for(const id of ['sunsetDisc','sunsetMaskDisc']){const c=$(id);c.setAttribute('cx',cx);c.setAttribute('cy',cy);c.setAttribute('r',radius);}paths.replaceChildren();for(let i=0;i<5;i++){const y=cy+20+i*13,amp=7+i*1.5,period=260;let d=`M ${cx-6*period} ${y}`;for(let k=0;k<12;k++)d+=` q ${period/4} ${-amp} ${period/2} 0 t ${period/2} 0`;const p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d',d);paths.append(p);}}
 new ResizeObserver(sunset).observe($('wavePanel'));sunset();
 const disclosure=$('playlistDisclosure');try{disclosure.open=localStorage.getItem('orbita-playlists-open')==='true';}catch{}disclosure.addEventListener('toggle',()=>{try{localStorage.setItem('orbita-playlists-open',String(disclosure.open));}catch{}});
})();
