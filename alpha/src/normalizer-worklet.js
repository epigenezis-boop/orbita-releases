'use strict';
class OrbitaNormalizerProcessor extends AudioWorkletProcessor{
 constructor(){super();this.enabled=true;this.volume=1;this.reset(null);this.port.onmessage=e=>{const m=e.data;if(m.type==='volume')this.volume=m.value;else if(m.type==='track'){this.track=m.track;this.reset(m.profile,m.complete);}else if(m.type==='profile'){const db=this.control.db;this.control.reset(m.profile);this.control.db=db;}else if(m.type==='enabled')this.enabled=!!m.value;};}
 reset(profile,complete=true){this.meter=null;this.channels=0;this.control=new OrbitaLoudness.Control();this.control.reset(profile,complete);this.reportAt=0;}
 process(inputs,outputs){const source=inputs[0],out=outputs[0];if(!source?.length){for(const c of out)c.fill(0);return true;}if(!this.meter||source.length!==this.channels){this.channels=source.length;this.meter=new OrbitaLoudness.Meter(sampleRate,Math.min(2,source.length));}
 if(this.volume>0&&this.enabled&&!this.control.fixed)this.meter.push(source,1/this.volume);if(currentTime-this.reportAt>=1){this.reportAt=currentTime;const p=this.meter.result();this.control.update(p);this.port.postMessage({track:this.track,profile:p,gainDb:this.enabled?this.control.db:0});}
 const step=1/sampleRate;for(let i=0;i<out[0].length;i++){const gain=this.control.step(step,this.enabled);for(let c=0;c<out.length;c++)out[c][i]=(source[Math.min(c,source.length-1)]?.[i]||0)*gain;}return true;}
}
registerProcessor('orbita-normalizer',OrbitaNormalizerProcessor);
