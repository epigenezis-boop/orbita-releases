const {test}=require('node:test'),assert=require('node:assert/strict');
const {responseDetails}=require('../src/response-diagnostics.cjs');const {Diagnostics}=require('../src/diagnostics.cjs');
test('HTML classifier exports fixed evidence without private page content and retains failures',async()=>{
 const r=new Response('<html>Kaspersky request blocked token=PRIVATE user@example.com</html>',{status:499,headers:{server:'nginx','set-cookie':'secret=PRIVATE'}});
 const x=await responseDetails(r,'https://cdn.example/private?token=PRIVATE');assert.deepEqual(x.markers,['kaspersky','request-blocked','html']);
 const d=new Diagnostics();d.add('audio-response',{...x,status:499});for(let i=0;i<120;i++)d.add('catalog');const report=d.report({});assert.equal(report.failures.length,1);assert.ok(!JSON.stringify(report).includes('PRIVATE'));assert.ok(!JSON.stringify(report).includes('user@example'));assert.equal(report.failures[0].host,'cdn.example');
});
test('successful audio body remains readable',async()=>{const r=new Response('audio');await responseDetails(r,'https://cdn.example/music');assert.equal(await r.text(),'audio');});
