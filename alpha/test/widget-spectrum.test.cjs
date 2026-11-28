const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('widget FFT channel accepts only main frame, visible widget, and 24 byte magnitudes',()=>{
 const source=fs.readFileSync(require('node:path').join(__dirname,'../src/main.cjs'),'utf8');const start=source.indexOf(" ipcMain.on('player-spectrum'");const end=source.indexOf(" ipcMain.on('widget-action'",start);let handler;const sent=[];const frame={url:'file:///orbita/index.html'},wc={mainFrame:frame};let visible=true;const context={ipcMain:{on:(_n,h)=>handler=h},quitting:false,win:{isDestroyed:()=>false,webContents:wc},mini:{isDestroyed:()=>false,isVisible:()=>visible,webContents:{send:(...v)=>sent.push(v)}},ui:frame.url};vm.runInNewContext(source.slice(start,end),context);
 const event={sender:wc,senderFrame:frame},levels=Array(24).fill(120);
 handler(event,levels);assert.equal(sent.length,1);assert.equal(sent[0][0],'widget-spectrum');
 for(const bad of [Array(25).fill(1),Array(24).fill(256),Array(24).fill(NaN),Array(24).fill('120'),null])handler(event,bad);
 handler({...event,sender:{}},levels);handler({...event,senderFrame:{url:frame.url}},levels);visible=false;handler(event,levels);assert.equal(sent.length,1);
});
