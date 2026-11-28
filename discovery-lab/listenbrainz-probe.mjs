// Orbita Discovery experiment; Node 18+ and curl (Windows: curl.exe).
import {spawn} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';

function flattenRadio(data, seed) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error('Unexpected radio response');
  const ids = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
  const seen = new Set(), rows = [];
  for (const [artist, tracks] of Object.entries(data)) {
    if (!ids.test(artist) || !Array.isArray(tracks)) continue;
    for (const t of tracks) {
      if (!ids.test(t?.recording_mbid || '') || seen.has(t.recording_mbid)) continue;
      seen.add(t.recording_mbid);
      rows.push({recording_mbid:t.recording_mbid, artist_mbid:artist, artist_name:t.similar_artist_name ?? null, listen_count:Number.isFinite(t.total_listen_count)?t.total_listen_count:null, seed_artist_mbid:seed, source:'listenbrainz-radio'});
    }
  }
  return rows;
}
function selectArtist(data,name) {
  const norm = s => String(s??'').normalize('NFKC').trim().toLowerCase();
  const matches=(data.artists??[]).filter(a=>norm(a.name)===norm(name));
  if(matches.length!==1) throw Error('Artist ambiguous or not found. Use an explicit MBID. Matches: '+JSON.stringify(matches.map(a=>({id:a.id,name:a.name,disambiguation:a.disambiguation}))));
  return matches[0].id;
}

const mbid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MB = 'https://musicbrainz.org/ws/2';
const LB = 'https://api.listenbrainz.org/1';
const agent = 'OrbitaDiscoveryLab/0.1 (https://github.com/epigenezis-boop/orbita-releases)';
const token = process.env.LISTENBRAINZ_TOKEN || '';
const proxy = process.env.ORBITA_DISCOVERY_PROXY || '';
let lastRequest = 0;
async function get(base,path,params={},auth=false) {
  const url = new URL(base+path);
  for(const [k,v] of Object.entries(params)) url.searchParams.set(k,String(v));
  const delay=1100-(Date.now()-lastRequest);
  if(delay>0) await sleep(delay);
  lastRequest=Date.now();
  // Credentials are passed through stdin, not command line arguments.
  const args=['--silent','--show-error','--connect-timeout','10','--max-time','30','--write-out','\\n%{http_code}','--config','-'];
  const settings=['url = '+JSON.stringify(url.toString()),'user-agent = '+JSON.stringify(agent),'header = "Accept: application/json"'];
  if(proxy) settings.push('proxy = '+JSON.stringify(proxy));
  if(auth && token) {
    if(!/^[A-Za-z0-9_-]+$/.test(token)) throw Error('Invalid token format');
    settings.push('header = '+JSON.stringify('Authorization: Token '+token));
  }
  const output=await new Promise((resolve,reject)=>{
    const child=spawn(process.platform==='win32'?'curl.exe':'curl',args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',d=>stdout+=d);
    child.stderr.on('data',d=>stderr+=d);
    child.on('error',reject);
    child.stdin.on('error',reject);
    child.on('close',code=>code===0?resolve(stdout):reject(Error('curl exit '+code+': '+stderr.trim())));
    child.stdin.end(settings.join('\n')+'\n');
  });
  const split=output.lastIndexOf('\n');
  const status=Number(output.slice(split+1));
  if(status===204) return null;
  if(status!==200) throw Error(url.hostname+' '+path+' HTTP '+status+(status===401||status===403?' (check ListenBrainz token)':status===429?' (rate limit: stop and try later)':''));
  return JSON.parse(output.slice(0,split));
}

async function main(){
  const [seed='Nightwish',mode='medium',countText='12',output='discovery-report.json']=process.argv.slice(2);
  if(!['easy','medium','hard'].includes(mode)) throw Error('Mode must be easy, medium or hard');
  const count=Number(countText);
  if(!Number.isInteger(count)||count<1||count>30) throw Error('Count must be 1..30');
  const safeSeed=seed.replace(/[+\-!(){}\[\]^"~*?:\\/]/g,'\\$&');
  const seedId=mbid.test(seed)?seed:selectArtist(await get(MB,'/artist',{query:'artist:"'+safeSeed+'"',fmt:'json',limit:25}),seed);
  console.error('Seed MBID: '+seedId);
  const radio=await get(LB,'/lb-radio/artist/'+seedId,{mode,max_similar_artists:12,max_recordings_per_artist:3,pop_begin:0,pop_end:100},true);
  const all=radio?flattenRadio(radio,seedId):[];
  // Round-robin across artists, rather than taking all tracks from the first artist.
  const groups=new Map();
  for(const row of all.filter(x=>x.artist_mbid!==seedId)){if(!groups.has(row.artist_mbid))groups.set(row.artist_mbid,[]);groups.get(row.artist_mbid).push(row);}
  const chosen=[];
  while(chosen.length<count && [...groups.values()].some(x=>x.length)){
    for(const rows of groups.values()){if(rows.length && chosen.length<count)chosen.push(rows.shift());}
  }
  const candidates=[];
  for(const row of chosen){
    const recording=await get(MB,'/recording/'+row.recording_mbid,{fmt:'json',inc:'artist-credits+releases+isrcs'});
    const releases=(recording.releases??[]).map(r=>({mbid:r.id,title:r.title,date:r.date??null}));
    candidates.push({...row,title:recording.title,artist_credit:(recording['artist-credit']??[]).map(a=>a.name+(a.joinphrase??'')).join('')||row.artist_name,duration_ms:recording.length??null,isrcs:recording.isrcs??[],releases,zvuk_match_status:'not_checked'});
  }
  await writeFile(output,JSON.stringify({schema_version:1,generated_at:new Date().toISOString(),seed,seed_artist_mbid:seedId,mode,raw_candidate_count:all.length,candidates},null,2)+'\n','utf8');
  console.table(candidates.map(x=>({artist:x.artist_credit,title:x.title,album:x.releases[0]?.title??'',listens:x.listen_count})));
  console.error('Report: '+output+'; Zvuk matching not performed.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
