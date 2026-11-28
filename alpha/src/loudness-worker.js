'use strict';
importScripts('loudness-core.js');
onmessage=e=>{try{const {channels,rate}=e.data;const meter=new OrbitaLoudness.Meter(rate,channels.length);for(let at=0;at<channels[0].length;at+=8192)meter.push(channels.map(c=>c.subarray(at,at+8192)));postMessage({ok:true,profile:meter.result()});}catch{postMessage({ok:false});}};
