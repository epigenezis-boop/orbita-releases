'use strict';
const Search=require('./smart-search.js');
const TRACK = 'id title duration artists { id title } release { id title image { src } }';
function id(value) { const s=String(value); if(!/^\d{1,24}$/.test(s)) throw new Error('Некорректный ID'); return s; }
function https(value) { try { const u=new URL(value); if(u.protocol==='https:' && !u.username && !u.password) return u.href; } catch {} throw new Error('Сервис вернул неподдерживаемый адрес потока'); }
function validItem(t){return !!t&&/^\d{1,24}$/.test(String(t.id));}
function track(t) { const artists=Array.isArray(t.artists)?t.artists.filter(validItem):[];return {id:id(t.id),title:String(t.title||'Без названия'),artist:artists.map(a=>a.title).join(', '),artists:artists.map(a=>({id:String(a.id),title:String(a.title||'Без имени')})),album:t.release?.title||'',albumId:validItem(t.release)?String(t.release.id):null,duration:Number(t.duration)||0,cover:t.release?.image?.src||''}; }
class API {
 constructor(request){this.request=request;this.token=null;}
 async likeTrack(value,liked){
 const trackId=id(value);if(typeof liked!=='boolean')throw Error('Некорректный лайк');
 const action=liked?'addItem':'removeItem';
 const data=await this.gql(`mutation OrbitaFavorite($id: ID, $type: CollectionItemType) { collection { ${action}(id: $id, type: $type) } }`,{id:trackId,type:'track'});
 if(!data.collection||data.collection[action]===false||data.collection[action]==null)throw Error('Запрос на '+(liked?'добавление в любимые':'удаление из любимых')+' отправлен. Нажми ↻ рядом с «Коллекция Zvuk», чтобы обновить список и проверить результат.');return liked;
 }
 async profile(token){
  let candidate=token,p=null;
  if(candidate===undefined){
   p=(await this.request('/api/tiny/profile',null,null))?.result;
   if(!p||p.is_anonymous===true||p.is_anonymous===1||p.is_anonymous==='true'||!p.token)
    throw new Error('[AUTH_SESSION] Сайт не передал авторизованную сессию. Используйте вход по токену.');
   candidate=p.token;
  }
  if(typeof candidate!=='string'||candidate.length<10||candidate.length>4096||/[\s"'<>]/.test(candidate))
   throw new Error('[AUTH_FORMAT] Вставьте только значение token: без кавычек, пробелов и JSON.');
  // Never replace a supplied token with an anonymous /profile response.
  // Verify in isolation so a failed attempt cannot overwrite a working session.
  const probe=new API(this.request);probe.token=candidate;
  await probe.collection();
  this.token=candidate;
  return {name:p?.name||p?.first_name||'Мой аккаунт'};
 }
 async gql(query,variables={}){
  if(!this.token)throw new Error('[AUTH_REQUIRED] Сначала подключите аккаунт');
  const d=await this.request('/api/v1/graphql',{query,variables,...(/^query getStream\b/.test(query)?{operationName:'getStream'}:{})},this.token);
  if(d.errors?.length){
   const text=d.errors.map(e=>String(e.extensions?.code||'')+' '+String(e.message||'')).join(' ');
   const stage=/personalWaveContent/.test(query)?'WAVE':/mediaContents/.test(query)?'STREAM':/addItem|removeItem/.test(query)?'FAVORITE':'COLLECTION';
   const clean=value=>String(value||'').split(this.token).join('[token]').replace(/https?:\/\/[^\s"<>]+/gi,'[адрес]').replace(/(?:bearer|token|authorization)\s*[:=]?\s*[^\s,;]+/gi,'[данные скрыты]').replace(/[\r\n\t]+/g,' ').slice(0,420);
   const detail=d.errors.slice(0,2).map(e=>{const code=String(e.extensions?.code||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,60);const path=Array.isArray(e.path)?e.path.filter(x=>typeof x==='string'&&/^[A-Za-z_]{1,60}$/.test(x)).join('.'):' ';return [code,clean(e.message),path.trim()?('поле: '+path):''].filter(Boolean).join(' · ');}).join('; ');
   if(/device[ _-]?id.*limit|device.*limit.*exceed/i.test(text))throw new Error('[DEVICE_LIMIT/'+stage+'] Звук отклонил запрос аудио с ошибкой Device id limit exceeded. Это сообщение само по себе не подтверждает исчерпание токенов. Сохраните диагностику. '+detail);
   if(/rate.?limit|too many|throttl/i.test(text))throw new Error('[API_RATE_LIMIT/'+stage+'] Звук ограничил частоту запросов. Подождите минуту перед повторным запуском. '+detail);
   if(/subscription|premium|payment|entitlement/i.test(text))throw new Error('[API_ACCESS/'+stage+'] Звук не подтвердил доступ к воспроизведению по подписке. '+detail);
   if(/unauth|forbidden|not.authoriz|invalid.token|expired.token/i.test(text))throw new Error('[AUTH_REJECTED] Звук отклонил токен. Войдите на сайт заново и скопируйте свежий token.');
   if(/cannot query|unknown argument|unknown type|validation/i.test(text))throw new Error('[API_SCHEMA/'+stage+'] Изменился формат API Звука. '+detail);
   throw new Error('[API_GRAPHQL/'+stage+'] API Звука отклонил запрос. '+detail);
  }
  if(!d.data)throw new Error('[API_EMPTY] Пустой ответ сервиса');return d.data;
 }
 async collection(){const d=await this.gql('query { collection { tracks { id } playlists { id } } }');if(!d.collection||!Array.isArray(d.collection.tracks)||!Array.isArray(d.collection.playlists))throw new Error('[AUTH_COLLECTION] Звук не предоставил коллекцию. Токен не подтверждён.');return {tracks:d.collection.tracks,playlists:d.collection.playlists};}
 async tracks(ids){if(!Array.isArray(ids)||ids.length>100)throw new Error('Слишком много треков');const d=await this.gql(`query($ids:[ID!]!){getTracks(ids:$ids){${TRACK}}}`,{ids:ids.map(id)});const rows=(d.getTracks||[]).filter(Boolean).map(track);const m=new Map(rows.map(t=>[t.id,t]));return ids.map(i=>m.get(String(i))).filter(Boolean);}
 async playlists(ids){if(!Array.isArray(ids)||ids.length>100)throw new Error('Слишком много плейлистов');const d=await this.gql('query($ids:[ID!]!){playlists(ids:$ids){id title image{src} duration}}',{ids:ids.map(id)});return (d.playlists||[]).filter(Boolean).map(p=>({id:id(p.id),title:p.title,cover:p.image?.src||''}));}
 async playlist(value,offset=0){if(!Number.isSafeInteger(offset)||offset<0)throw new Error('Некорректная страница');const d=await this.gql(`query($id:ID!,$offset:Int!){playlistTracks(id:$id,limit:100,offset:$offset){${TRACK}}}`,{id:id(value),offset});return (d.playlistTracks||[]).map(track);}
 async search(q,cursor=null){
 if(typeof q!=='string'||q.trim().length<2||q.length>200)throw Error('Введите от 2 до 200 символов');
 if(cursor!==null&&(typeof cursor!=='string'||cursor.length>4096))throw Error('Некорректная страница поиска');
 const d=await this.gql(`query OrbitaSearch($q:String,$cursor:Cursor){search(query:$q){tracks(limit:100,cursor:$cursor){page{next} items{${TRACK}}}}}`,{q:q.trim(),cursor});
 const result=d.search?.tracks;if(!result||!Array.isArray(result.items))throw Error('[SEARCH_EMPTY] Звук не предоставил результаты поиска');
 return {tracks:Search.rank(result.items.filter(Boolean).map(track),q,true),next:result.page?.next||null};
 }
 async artist(value,offset=0){
 const artistId=id(value);if(!Number.isSafeInteger(offset)||offset<0)throw Error('Некорректная страница исполнителя');
 const d=await this.gql(`query OrbitaArtist($ids:[ID!]!,$offset:Int!,$popular:Boolean!){getArtists(ids:$ids){id title popularTracks(limit:100) @include(if:$popular){${TRACK}} releases(offset:$offset,limit:10){id}}}`,{ids:[artistId],offset,popular:offset===0});
 const a=d.getArtists?.[0];if(!a)throw Error('Исполнитель не найден');if(!Array.isArray(a.releases))throw Error('Звук не предоставил дискографию');
 let albums=[];const releaseIds=a.releases.filter(validItem).map(r=>id(r.id));let tracks=(Array.isArray(a.popularTracks)?a.popularTracks:[]).filter(validItem).map(track);
 if(releaseIds.length){const r=await this.gql(`query OrbitaArtistReleases($ids:[ID!]!){getReleases(ids:$ids){id title date image{src} tracks{${TRACK}}}}`,{ids:releaseIds});if(!Array.isArray(r.getReleases))throw Error('Звук не предоставил треки альбомов');albums=r.getReleases.filter(validItem).map(x=>({id:String(x.id),title:String(x.title||'Альбом'),date:String(x.date||''),year:/^\d{4}/.test(String(x.date||''))?Number(String(x.date).slice(0,4)):null,cover:x.image?.src||''}));tracks.push(...r.getReleases.filter(Boolean).flatMap(r=>Array.isArray(r.tracks)?r.tracks:[]).filter(validItem).filter(t=>Array.isArray(t.artists)&&t.artists.some(x=>x&&String(x.id)===artistId)).map(track));}
 return {id:artistId,title:String(a.title),albums,tracks:[...new Map(tracks.map(t=>[t.id,t])).values()],next:a.releases.length===10?offset+10:null};
 }
 async album(value){
 const albumId=id(value);const d=await this.gql(`query OrbitaAlbum($ids:[ID!]!){getReleases(ids:$ids){id title artists{id title} tracks{${TRACK}}}}`,{ids:[albumId]});
 const album=d.getReleases?.find(r=>r&&String(r.id)===albumId);if(!album)throw Error('Альбом не найден или недоступен');if(!Array.isArray(album.tracks))throw Error('Звук не предоставил треки альбома');
 return {id:albumId,title:String(album.title||'Альбом'),artist:(album.artists||[]).filter(validItem).map(a=>String(a.title||'')).join(', '),tracks:album.tracks.filter(validItem).map(t=>track({...t,release:{...t.release,id:albumId,title:album.title}}))};
 }
 async wave(settings={}){
  if(!settings||typeof settings!=='object')throw new Error('Некорректные настройки потока');
  const options={popular:null};
  if(settings.mood){
   const {energy,fun}=settings;
   if(typeof energy!=='number'||typeof fun!=='number'||!Number.isFinite(energy)||!Number.isFinite(fun))throw new Error('Энергия и веселье должны быть числами');
   options.mood=`energy:${energy},fun:${fun}`;
  }
  const d=await this.gql(`query getPersonalWave($first:PositiveInt!,$options:PersonalWaveOptions,$waveSrc:MagicSource){personalWaveContent(first:$first,options:$options,waveSrc:$waveSrc){${TRACK}}}`,{waveSrc:'AMAZME',first:2,options});
  if(!Array.isArray(d.personalWaveContent))throw new Error('[WAVE_EMPTY] Звук не вернул персональный поток');
  return d.personalWaveContent.filter(Boolean).map(track);
 }
 async stream(value,quality='high',details=false){
  if(!['hifi','high','mid'].includes(quality))throw new Error('Неизвестное качество');
  const d=await this.gql('query getStream($ids:[ID!]!){mediaContents(ids:$ids){... on Track{stream{expire flac high mid}}}}',{ids:[id(value)]});
  const stream=d.mediaContents?.[0]?.stream;
  const actual=quality==='hifi'&&stream?.flac?'hifi':quality!=='mid'&&stream?.high?'high':'mid';const url=actual==='hifi'?stream?.flac:actual==='high'?stream?.high:stream?.mid;
  if(!url&&d.mediaContents?.[0]?.streamV3?.hls)throw new Error('[STREAM_FORMAT] Звук вернул только HLS-поток. Эта сборка воспроизводит прямые аудиопотоки; нужен отдельный адаптер HLS.');
  if(!url)throw new Error('[STREAM_UNAVAILABLE] Звук не предоставил поток выбранного качества для этого трека. Попробуйте другой трек или качество.');
  return details?{url:https(url),quality:actual,requested:quality,...(stream.expire!==undefined?{expire:stream.expire}:{})}:https(url);
 }

}
module.exports={API,id,https,track};
