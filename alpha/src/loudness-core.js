'use strict';
// BS.1770 K-weighting and 400 ms gated energy measurement (mono/stereo).
// This implementation uses sample peaks with a safety margin, not a true-peak meter.
(function(root){
 const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
 function coefficients(rate){
  let k=Math.tan(Math.PI*1681.974450955533/rate),q=.7071752369554196,v=10**(3.999843853973347/20),m=v**.4996667741545416,d=1+k/q+k*k;
  const shelf=[(v+m*k/q+k*k)/d,2*(k*k-v)/d,(v-m*k/q+k*k)/d,2*(k*k-1)/d,(1-k/q+k*k)/d];
  k=Math.tan(Math.PI*38.13547087602444/rate);q=.5003270373238773;d=1+k/q+k*k;
  return [shelf,[1,-2,1,2*(k*k-1)/d,(1-k/q+k*k)/d]];
 }
 class Biquad{constructor(c){this.c=c;this.z1=0;this.z2=0;}sample(x){const [b0,b1,b2,a1,a2]=this.c,y=b0*x+this.z1;this.z1=b1*x-a1*y+this.z2;this.z2=b2*x-a2*y;return y;}}
 class Meter{
  constructor(rate,channels=2){this.rate=rate;this.hop=Math.round(rate*.1);this.filters=Array.from({length:channels},()=>coefficients(rate).map(c=>new Biquad(c)));this.parts=[];this.blocks=[];this.frames=0;this.sum=0;this.peak=0;this.total=0;this.activeSeconds=0;}
  push(channels,scale=1){const count=Math.min(channels.length,this.filters.length),length=channels[0]?.length||0;for(let i=0;i<length;i++){for(let c=0;c<count;c++){let x=channels[c][i]*scale;if(!Number.isFinite(x))x=0;this.peak=Math.max(this.peak,Math.abs(x));for(const f of this.filters[c])x=f.sample(x);this.sum+=x*x;}this.total++;if(++this.frames===this.hop){this.parts.push(this.sum/this.hop);if(this.parts.length>4)this.parts.shift();if(this.parts.length===4){const e=this.parts.reduce((a,b)=>a+b,0)/4;if(e>10**((-70+.691)/10)){this.blocks.push(e);this.activeSeconds+=.1;}if(this.blocks.length>36000)this.blocks.shift();}this.frames=0;this.sum=0;}}}
  result(){if(!this.blocks.length)return {lufs:null,peak:this.peak,seconds:this.total/this.rate,activeSeconds:this.activeSeconds};const avg=this.blocks.reduce((a,b)=>a+b,0)/this.blocks.length,gate=avg*.1;let sum=0,n=0;for(const b of this.blocks)if(b>=gate){sum+=b;n++;}return {lufs:n?-.691+10*Math.log10(sum/n):null,peak:this.peak,seconds:this.total/this.rate,activeSeconds:this.activeSeconds};}
 }
 // Gentle normalization: keep familiar playback level and limit corrections.
 function gainFor(profile){
  if(!profile||!Number.isFinite(profile.lufs)||profile.lufs<-50)return 0;
  const difference=-14-profile.lufs;
  if(Math.abs(difference)<=1)return 0;
  if(difference<0)return Math.max(-4,difference);
  const headroom=profile.peak>0?-1-20*Math.log10(profile.peak):0;
  return Math.max(0,Math.min(4,difference,headroom));
 }

 class Control{
  constructor(){this.reset();}
  reset(profile=null,fixed=true){this.db=profile?gainFor(profile):0;this.estimate=profile?this.db:null;this.fixed=!!profile&&fixed;}
  update(p){if(this.fixed||p.activeSeconds<6||p.lufs===null)return;const proposed=gainFor(p);if(this.estimate===null)this.estimate=proposed;else this.estimate=Math.min(this.estimate,proposed);}
  step(seconds,enabled=true){const target=enabled?(this.estimate??0):0;const speed=!enabled?120:target<this.db?3:1;this.db+=clamp(target-this.db,-speed*seconds,speed*seconds);return 10**(this.db/20);}
 }
 const api={Meter,Control,gainFor};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.OrbitaLoudness=api;
})(globalThis);
