'use strict';
const {app,BrowserWindow,ipcMain,session,safeStorage,Menu,Tray,nativeImage,dialog,protocol,net,screen}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');const {API}=require('./api.cjs');
const crypto=require('node:crypto');
const {Discovery}=require('./discovery/service.cjs');
const {createProviders,DiscoveryError}=require('./discovery/providers.cjs');
const {createStorage}=require('./discovery/storage.cjs');
const {openMusicGraph}=require('./graph/index.cjs');
const {createPlaybackTracker}=require('./graph/playback.cjs');
// Alpha owns its profile and instance lock independently of the installed stable edition.
const profileData=path.join(app.getPath('appData'),'orbita-player-alpha');fs.mkdirSync(profileData,{recursive:true});app.setPath('userData',profileData);app.setPath('sessionData',profileData);app.setName('Orbita Alpha');
if(process.platform==='win32')app.setAppUserModelId('Orbita.Player.Alpha');
const i18n=require('./i18n.js');const languageStore=new (require('./language-store.cjs').LanguageStore)(path.join(profileData,'orbita-language.json'));i18n.setLanguage(languageStore.value);
ipcMain.on('language-current',event=>{event.returnValue=languageStore.value;});
const {LocalLibrary}=require('./local-library.cjs');const {MediaBroker}=require('./media.cjs');
protocol.registerSchemesAsPrivileged([{scheme:'volna-media',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true,stream:true}}]);
const diagnostics=new (require('./diagnostics.cjs').Diagnostics)();let localLibrary,media,loudnessStore,playbackStore,streamGeneration=0,streamRequests;
const authChildren=new Set();
let updates;let discovery;let settingsWindow;let win,auth,web,api,tray,mini,modes,playerState={paused:true,volume:.7,time:0,duration:0},quitting=false;let lastMiniCover;let musicGraph,playbackTracker;
function sendMiniState(force=false){if(!mini||mini.isDestroyed())return;const packet={...playerState};if(!force&&packet.cover===lastMiniCover)delete packet.cover;else lastMiniCover=packet.cover;mini.webContents.send('widget-state',packet);}
const widgetUI=pathToFileURL(path.join(__dirname,'widget.html')).href;const ui=pathToFileURL(path.join(__dirname,'index.html')).href;
const vault=()=>path.join(app.getPath('userData'),'account.bin');
const prefs={contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true};
function stored(){try{return safeStorage.decryptString(fs.readFileSync(vault()));}catch{return null;}}
function save(){diagnostics.add('account-operation',{stage:api.token===stored()?'save-unchanged':'save-changed'});if(!safeStorage.isEncryptionAvailable())throw new Error(i18n.t('Windows не предоставила защищённое хранилище. Вход не сохранён.'));fs.writeFileSync(vault(),safeStorage.encryptString(api.token),{mode:0o600});}
let transport,accountSession,siteIdentity;
function request(route,body,token,signal){diagnostics.add('api-call',{source:'application',operation:route==='/api/tiny/profile'?'site-session-read':/^query getStream\b/.test(body?.query||'')?'getStream':'catalog',stage:token?'saved-token':'site-cookies'});return transport.request(route,body,token,signal);}
function harden(w){w.webContents.setWindowOpenHandler(()=>({action:'deny'}));w.webContents.on('will-navigate',e=>e.preventDefault());}
function authWindow(){
 if(auth&&!auth.isDestroyed()){auth.show();return;}
 auth=new BrowserWindow({width:1000,height:800,title:i18n.t('Вход на zvuk.com — после входа вернитесь в плеер'),autoHideMenuBar:true,webPreferences:{...prefs,session:web}});
 const secure=url=>{try{return new URL(url).protocol==='https:';}catch{return false;}};
 const secureWindow=w=>{for(const event of ['will-navigate','will-redirect'])w.webContents.on(event,(e,url)=>{if(!secure(url))e.preventDefault();});w.webContents.setWindowOpenHandler(({url})=>secure(url)?{action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true,webPreferences:{...prefs,session:web}}}:{action:'deny'});w.webContents.on('did-create-window',child=>{authChildren.add(child);child.on('closed',()=>authChildren.delete(child));secureWindow(child);});};
 secureWindow(auth);auth.on('closed',()=>{auth=null;});auth.loadURL('https://zvuk.com/').catch(()=>{});
}
function handle(name,fn,scope){ipcMain.handle(name,async(e,...args)=>{const fromMain=e.sender===win.webContents&&e.senderFrame===win.webContents.mainFrame&&e.senderFrame.url===ui;const fromSettings=settingsWindow&&!settingsWindow.isDestroyed()&&e.sender===settingsWindow.webContents&&e.senderFrame===settingsWindow.webContents.mainFrame&&e.senderFrame.url===pathToFileURL(path.join(__dirname,'settings.html')).href&&['quality-get','quality-set','auth-open','connect','restore','logout','theme-get','theme-set','diagnostics-export','normalization-get','normalization-set','stream-unblock','updates-get','updates-check','updates-download','updates-auto','updates-install','language-set','widget-get','widget-set'].includes(name);const settingsSender=scope==='settings'&&settingsWindow&&!settingsWindow.isDestroyed()&&e.sender===settingsWindow.webContents&&e.senderFrame===settingsWindow.webContents.mainFrame&&e.senderFrame.url===pathToFileURL(path.join(__dirname,'settings.html')).href;if(!(scope==='settings'?settingsSender:scope==='main'?fromMain:fromMain||fromSettings))throw new Error('Forbidden');try{return {ok:true,value:await fn(...args)};}catch(error){if(scope)return {ok:false,error:error instanceof DiscoveryError?error.message:'internal'};const code=String(error.message||'').match(/\[([A-Z0-9_\/]+)\]/)?.[1]||'UNKNOWN';diagnostics.add('api-error',{source:'application',stage:name,error:code});return {ok:false,error:error.message};}});}
if(require('./single-instance.cjs').singleInstance(app,()=>win)){
app.whenReady().then(async()=>{
 localLibrary=new LocalLibrary(path.join(app.getPath('userData'),'local-library.json'),p=>{if(win&&!win.isDestroyed())win.webContents.send('local-progress',p);},b=>{const image=nativeImage.createFromBuffer(b);if(image.isEmpty())return null;return image.resize({width:256,height:256,quality:'good'}).toJPEG(85);});await localLibrary.load();loudnessStore=new (require('./loudness-store.cjs').LoudnessStore)(path.join(app.getPath('userData'),'orbita-loudness.json'),localLibrary);playbackStore=new (require('./playback-store.cjs').PlaybackStore)(path.join(app.getPath('userData'),'orbita-playback.json'));media=new MediaBroker(localLibrary,(url,opts)=>{diagnostics.add('media-request',{source:'account-session',operation:'audio'});return transport.audio(url,opts);},status=>{diagnostics.add('media',{source:'application',stage:status.code,status:status.status});if(status.code==='MEDIA_RESPONSE')return;playbackTracker?.invalidate();if(win&&!win.isDestroyed())win.webContents.send('stream-status',status);});protocol.handle('volna-media',req=>media.handle(req));
 web=session.fromPartition('persist:zvuk-account');const identityFile=path.join(app.getPath('userData'),'orbita-site-identity.bin');siteIdentity=new (require('./site-identity.cjs').SiteIdentity)({load:()=>JSON.parse(safeStorage.decryptString(fs.readFileSync(identityFile))),save:v=>{if(v){if(!safeStorage.isEncryptionAvailable())throw Error('Encryption unavailable');fs.writeFileSync(identityFile,safeStorage.encryptString(JSON.stringify(v)),{mode:0o600});}else fs.rmSync(identityFile,{force:true});},event:stage=>diagnostics.add('site-identity',{stage})});transport=new (require('./zvuk-transport.cjs').ZvukTransport)(web,siteIdentity,details=>diagnostics.add('audio-response',details));
 const filter={urls:['https://zvuk.com/api/v1/graphql*']};const source=d=>auth&&!auth.isDestroyed()&&d.webContentsId===auth.webContents.id?'site-window':d.webContentsId>0?'web-context':'application';
 web.webRequest.onBeforeRequest(filter,(d,cb)=>{let operation='other';try{const chunks=(d.uploadData||[]).filter(x=>x.bytes).map(x=>Buffer.from(x.bytes));if(chunks.reduce((n,x)=>n+x.length,0)<100000){const b=JSON.parse(Buffer.concat(chunks).toString());const op=b.operationName||String(b.query||'').match(/(?:query|mutation)\s+(\w+)/)?.[1];if(['getStream','getPersonalWave','addItemToCollection','removeItemFromCollection'].includes(op))operation=op;}}catch{}diagnostics.add('graphql-request',{source:source(d),operation,resourceType:d.resourceType});cb({cancel:false});});
 web.webRequest.onBeforeSendHeaders(filter,(d,cb)=>{if(d.webContentsId>0&&(d.initiatorOrigin==='https://zvuk.com'||d.frame?.url?.startsWith('https://zvuk.com/')))siteIdentity.observe(d.requestHeaders);const cookie=Object.entries(d.requestHeaders).find(([k])=>k.toLowerCase()==='cookie')?.[1]||'';diagnostics.add('request-headers',{source:source(d),headers:Object.keys(d.requestHeaders),cookieNames:String(cookie).split(';').map(x=>x.trim().split('=')[0]).filter(Boolean)});cb({requestHeaders:d.requestHeaders});});
 web.webRequest.onCompleted(filter,d=>diagnostics.add('graphql-http',{source:source(d),status:d.statusCode}));web.webRequest.onErrorOccurred(filter,d=>diagnostics.add('network-error',{source:source(d),error:d.error}));
 web.on('will-download',event=>event.preventDefault());session.defaultSession.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
 web.setPermissionRequestHandler((_wc,_p,cb)=>cb(false));web.setPermissionCheckHandler(()=>false);api=new API(request);
 registerDiscovery();
 const limitFile=path.join(app.getPath('userData'),'orbita-stream-limit.json');let blockedStream=null;try{if(JSON.parse(fs.readFileSync(limitFile,'utf8')).blocked)blockedStream=i18n.t('[STREAM_PAUSED] Orbita сохранила блокировку после предыдущего ответа сервиса. Новый запрос аудио не отправлен. Для одной новой проверки нажми «Повторить проверку аудио» в настройках.');}catch{}
 streamRequests=new (require('./stream-requests.cjs').StreamRequests)((id,q)=>api.stream(id,q,true),{blocked:blockedStream,changed:error=>{try{if(error)fs.writeFileSync(limitFile,JSON.stringify({blocked:true,time:new Date().toISOString()}));else fs.rmSync(limitFile,{force:true});}catch{diagnostics.add('stream-guard',{stage:'persistence-error'});}},event:stage=>diagnostics.add('stream-guard',{stage})});
 handle('stream-unblock',()=>{streamRequests.unblock();return true;});
 const workArea=screen.getPrimaryDisplay().workArea;
 win=new BrowserWindow({width:Math.min(1440,workArea.width),height:Math.min(940,workArea.height),minWidth:1050,minHeight:700,backgroundColor:'#12141d',title:i18n.t('Orbita Alpha — музыкальная станция'),icon:path.join(__dirname,'icon.png'),autoHideMenuBar:true,webPreferences:{...prefs,backgroundThrottling:false,preload:path.join(__dirname,'preload.cjs')}});harden(win);win.loadFile(path.join(__dirname,'index.html'));Menu.setApplicationMenu(null);
 const widgetPrefs=new (require('./widget-preferences.cjs').WidgetPreferences)(path.join(profileData,'orbita-widget.json'));
 mini=new BrowserWindow({width:420,height:188,show:false,frame:false,resizable:false,maximizable:false,minimizable:false,alwaysOnTop:widgetPrefs.value.alwaysOnTop,skipTaskbar:true,backgroundColor:'#252a40',title:i18n.t('Orbita Alpha — мини-плеер'),icon:path.join(__dirname,'icon.png'),webPreferences:{...prefs,preload:path.join(__dirname,'widget-preload.cjs')}});harden(mini);mini.loadFile(path.join(__dirname,'widget.html'));
 const {installWindowModes,widgetPosition}=require('./window-modes.cjs');const {fitBounds}=require('./widget-preferences.cjs');
 let placed=false,adjusting=false,lastMainBounds=win.getBounds();
 for(const event of ['move','resize'])win.on(event,()=>{if(!win.isMinimized())lastMainBounds=win.getBounds();});
 function positionWidget(){
  const saved=!placed&&widgetPrefs.value.rememberPosition?widgetPrefs.value.bounds:null;
  const candidate=saved|| (placed?mini.getBounds():widgetPosition(screen.getDisplayMatching(lastMainBounds).workArea));
  const bounds=fitBounds(candidate,screen.getAllDisplays().map(d=>d.workArea));
  adjusting=true;try{mini.setBounds(bounds);}finally{adjusting=false;}placed=true;
 }
 let moveTimer;mini.on('move',()=>{if(adjusting||!placed)return;clearTimeout(moveTimer);moveTimer=setTimeout(()=>{if(!mini.isDestroyed())widgetPrefs.saveBounds(mini.getBounds());},200);});
 const screensChanged=()=>{if(placed){positionWidget();widgetPrefs.saveBounds(mini.getBounds());}};
 for(const event of ['display-added','display-removed','display-metrics-changed'])screen.on(event,screensChanged);
 mini.on('closed',()=>{clearTimeout(moveTimer);for(const event of ['display-added','display-removed','display-metrics-changed'])screen.removeListener(event,screensChanged);});
 mini.on('close',()=>{if(placed)widgetPrefs.saveBounds(mini.getBounds());});
 app.on('before-quit',()=>{if(placed&&!mini.isDestroyed())widgetPrefs.saveBounds(mini.getBounds());});
 modes=installWindowModes(win,mini,{isQuitting:()=>quitting,requestState:()=>{win.webContents.send('state-request');sendMiniState(true);},position:positionWidget});
 handle('widget-get',()=>widgetPrefs.snapshot());
 handle('widget-set',value=>{widgetPrefs.set(value);mini.setAlwaysOnTop(widgetPrefs.value.alwaysOnTop);if(placed)widgetPrefs.saveBounds(mini.getBounds());return widgetPrefs.snapshot();});
 ipcMain.on('player-state',(e,s)=>{if(quitting||win.isDestroyed()||mini.isDestroyed())return;if(e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame||e.senderFrame.url!==ui||!s||typeof s!=='object')return;const number=(v,max)=>typeof v==='number'&&Number.isFinite(v)?Math.max(0,Math.min(v,max)):0;const cover=s.cover===undefined?playerState.cover:typeof s.cover==='string'&&s.cover.length<1500000&&(/^(https:\/\/|volna-media:\/\/cover\/[a-f0-9]{64}$|data:image\/(jpeg|png|webp);base64,)/.test(s.cover))?s.cover:'';playerState={trackId:typeof s.trackId==='string'&&/^(?:local-[\w-]+|\d{1,24})$/.test(s.trackId)?s.trackId:'',canLike:s.canLike===true,liked:s.liked===true,likePending:s.likePending===true,title:String(s.title||'').slice(0,500),artist:String(s.artist||'').slice(0,500),paused:!!s.paused,time:number(s.time,1e8),duration:number(s.duration,1e8),volume:number(s.volume,1),cover};playbackTracker?.update({...s,trackId:playerState.trackId,title:playerState.title,artist:playerState.artist,paused:playerState.paused,time:playerState.time,duration:playerState.duration});if(mini.isVisible())sendMiniState();});
 ipcMain.on('player-spectrum',(e,levels)=>{if(quitting||win.isDestroyed()||mini.isDestroyed()||!mini.isVisible())return;if(e.sender!==win.webContents||e.senderFrame!==win.webContents.mainFrame||e.senderFrame.url!==ui||!Array.isArray(levels)||levels.length!==24||!levels.every(n=>Number.isInteger(n)&&n>=0&&n<=255))return;mini.webContents.send('widget-spectrum',levels);});
 ipcMain.on('widget-action',(e,p)=>{if(quitting||win.isDestroyed()||mini.isDestroyed())return;if(e.sender!==mini.webContents||e.senderFrame!==mini.webContents.mainFrame||e.senderFrame.url!==widgetUI||!p)return;if(p.action==='expand'){modes.showMain();return;}if(p.action==='hide'){modes.hideAll();return;}if(p.action==='like'){if(playerState.canLike&&!playerState.likePending&&p.value===playerState.trackId)win.webContents.send('media',{action:'like',trackId:p.value});return;}if(['toggle','prev','next'].includes(p.action))win.webContents.send('media',{action:p.action});else if(['seek','volume'].includes(p.action)&&typeof p.value==='number'&&Number.isFinite(p.value)&&p.value>=0&&p.value<=1)win.webContents.send('media',{action:p.action,value:p.value});});
 mini.webContents.on('did-finish-load',()=>{sendMiniState(true);mini.webContents.send('theme',theme);});

 const icon=nativeImage.createFromPath(path.join(__dirname,'icon.png'));tray=new Tray(icon);tray.setToolTip('Orbita Alpha');function refreshTray(){tray.setContextMenu(Menu.buildFromTemplate([{label:i18n.t('Открыть плеер'),click:()=>modes.showMain()},{label:i18n.t('Воспроизведение / пауза'),click:()=>win.webContents.send('media','toggle')},{type:'separator'},{label:i18n.t('Выйти'),click:()=>{if(updates?.install(false))return;quitting=true;app.quit();}}]));}refreshTray();tray.on('double-click',()=>modes.showMain());
 const themeFile=path.join(app.getPath('userData'),'orbita-theme.json');let theme='classic';try{theme=JSON.parse(fs.readFileSync(themeFile,'utf8')).theme;}catch{}if(!['classic','light','green','purple'].includes(theme))theme='classic';
 handle('theme-get',()=>theme);handle('theme-set',value=>{if(!['classic','light','green','purple'].includes(value))throw Error(i18n.t('Неизвестная тема'));theme=value;fs.writeFileSync(themeFile,JSON.stringify({theme}));for(const w of [win,mini,settingsWindow])if(w&&!w.isDestroyed())w.webContents.send('theme',theme);return theme;});
 handle('settings-open',()=>{if(settingsWindow&&!settingsWindow.isDestroyed()){settingsWindow.show();settingsWindow.focus();return;}settingsWindow=new BrowserWindow({width:Math.min(720,screen.getDisplayMatching(win.getBounds()).workArea.width),height:Math.min(850,screen.getDisplayMatching(win.getBounds()).workArea.height),minWidth:600,minHeight:650,title:i18n.t('Orbita Alpha — настройки'),icon:path.join(__dirname,'icon.png'),autoHideMenuBar:true,webPreferences:{...prefs,preload:path.join(__dirname,'settings-preload.cjs')}});harden(settingsWindow);settingsWindow.loadFile(path.join(__dirname,'settings.html'));settingsWindow.on('closed',()=>{settingsWindow=null;});});
 const updateFile=path.join(app.getPath('userData'),'orbita-updates.json');
 // Alpha has no update feed. This also prevents reading stable update metadata.
 const updateSupported=false;
 updates=new (require('./updates.cjs').Updates)({updater:null,version:app.getVersion(),supported:updateSupported,
  load:()=>JSON.parse(fs.readFileSync(updateFile,'utf8')).automatic,
  save:automatic=>fs.writeFileSync(updateFile,JSON.stringify({automatic})),
  changed:state=>{for(const w of [win,settingsWindow])if(w&&!w.isDestroyed())w.webContents.send('updates',state);},
  beforeInstall:()=>{playbackStore.finish(playerState);}
 });
 handle('language-set',value=>{languageStore.set(value);i18n.setLanguage(value);refreshTray();win.setTitle(i18n.t('Orbita Alpha — музыкальная станция'));mini.setTitle(i18n.t('Orbita Alpha — мини-плеер'));if(settingsWindow&&!settingsWindow.isDestroyed())settingsWindow.setTitle(i18n.t('Orbita Alpha — настройки'));if(auth&&!auth.isDestroyed())auth.setTitle(i18n.t('Вход на zvuk.com — после входа вернитесь в плеер'));for(const w of [win,mini,settingsWindow])if(w&&!w.isDestroyed())w.webContents.send('language',value);return value;});
 handle('updates-get',()=>updates.snapshot());handle('updates-check',()=>updates.check());handle('updates-download',()=>updates.download());handle('updates-auto',v=>updates.setAutomatic(v));handle('updates-install',()=>updates.install(true));updates.start();
 handle('diagnostics-export',async()=>{const parent=settingsWindow&&!settingsWindow.isDestroyed()?settingsWindow:win;const r=await dialog.showSaveDialog(parent,{title:i18n.t('Сохранить диагностику Orbita'),defaultPath:'Orbita-diagnostics.json',filters:[{name:'JSON',extensions:['json']}]});if(r.canceled||!r.filePath)return false;const report=diagnostics.report({app:app.getVersion(),electron:process.versions.electron,platform:process.platform,architecture:process.arch});fs.writeFileSync(r.filePath,JSON.stringify(report,null,2),'utf8');return true;});
 handle('playback-load',()=>playbackStore.load(localLibrary.list()));handle('playback-save',value=>playbackStore.save(value));handle('playback-position',value=>playbackStore.position(value));
 const qualityFile=path.join(app.getPath('userData'),'orbita-quality.json');
 let preferredQuality='hifi';try{const q=JSON.parse(fs.readFileSync(qualityFile,'utf8')).quality;if(['hifi','high','mid'].includes(q))preferredQuality=q;}catch{preferredQuality=playbackStore.load(localLibrary.list())?.quality||'hifi';}
 handle('quality-get',()=>preferredQuality);handle('quality-set',q=>{if(!['hifi','high','mid'].includes(q))throw Error(i18n.t('Неизвестное качество'));fs.writeFileSync(qualityFile,JSON.stringify({quality:q}));preferredQuality=q;win.webContents.send('quality',q);return q;});
 handle('normalization-get',()=>loudnessStore.enabled);handle('normalization-set',value=>{const enabled=loudnessStore.setEnabled(value);win.webContents.send('normalization',enabled);return enabled;});
 handle('loudness-info',id=>loudnessStore.info(id));handle('loudness-local',id=>{const info=loudnessStore.info(id);if(!info?.eligible||!id.startsWith('local-'))throw Error(i18n.t('Файл недоступен для анализа'));return media.local(id);});handle('loudness-save',(id,stamp,p,complete)=>loudnessStore.put(id,stamp,p,complete));
 handle('like-track',async(id,liked)=>{const result=await api.likeTrack(id,liked);try{const current=String(playerState.trackId||'')===String(id);musicGraph?.recordFavorite({id,title:current?playerState.title:'',artist:current?playerState.artist:''},liked);}catch{}return result;});
 handle('auth-open' ,()=>authWindow());
 accountSession=new (require('./account-session.cjs').AccountSession)({api,stored,save,resume:()=>transport.resume(),changed:()=>{discovery.accountChanged();win.webContents.send('account-changed');},clear:async()=>{streamRequests.cancelPending();streamGeneration++;media.stopRemote();api.token=null;streamRequests.unblock();for(const child of authChildren)if(!child.isDestroyed())child.close();if(auth)auth.close();await web.closeAllConnections();await web.clearStorageData();siteIdentity.clear();fs.rmSync(vault(),{force:true});}});
 handle('connect',async(token)=>{if(token!==undefined&&(typeof token!=='string'||token.length<10||token.length>4096||/[\r\n]/.test(token)))throw new Error(i18n.t('Неверный формат токена'));diagnostics.add('account-operation',{stage:token===undefined?'connect-site':'connect-manual'});const p=await accountSession.connect(token);if(auth)auth.close();return p;});
 handle('restore',()=>{diagnostics.add('account-operation',{stage:'restore'});return accountSession.restore();});
 handle('logout',()=>accountSession.logout());
 handle('wave',settings=>api.wave(settings));handle('collection',()=>api.collection());handle('tracks',ids=>api.tracks(ids));handle('playlists',ids=>api.playlists(ids));handle('playlist',(id,offset)=>api.playlist(id,offset));handle('search',(q,cursor)=>api.search(q,cursor));handle('artist',(id,offset)=>api.artist(id,offset));handle('album',id=>api.album(id));handle('stream',async(id,quality)=>{const generation=++streamGeneration;media.stopRemote();const stream=await streamRequests.request(id,quality);if(generation!==streamGeneration)throw Error(i18n.t('[PLAYBACK_SUPERSEDED] Выбран другой трек'));return {url:media.issue(stream.url,{expire:stream.expire,renew:async()=>{if(generation!==streamGeneration)throw Error('Superseded');const refreshed=await streamRequests.request(id,quality);if(generation!==streamGeneration)throw Error('Superseded');return refreshed;}}),quality:stream.quality,requested:stream.requested};});
 handle('local-list',()=>localLibrary.list());handle('local-stream',id=>{streamRequests.cancelPending();streamGeneration++;media.stopRemote();return media.local(id);});handle('local-remove',id=>{if(typeof id!=='string')throw Error(i18n.t('Некорректный трек'));return localLibrary.remove(id);});
 handle('local-add',async(kind)=>{if(!['files','folder'].includes(kind))throw Error(i18n.t('Некорректный выбор'));if(localLibrary.busy)throw Error(i18n.t('Дождитесь завершения добавления.'));const result=await dialog.showOpenDialog(win,{title:kind==='folder'?i18n.t('Выберите папку с музыкой'):i18n.t('Выберите аудиофайлы'),properties:kind==='folder'?['openDirectory']:['openFile','multiSelections'],filters:kind==='files'?[{name:i18n.t('Музыка'),extensions:['mp3','flac','wav','ogg','opus','m4a','aac','webm']}]:[]});if(result.canceled)return null;return localLibrary.add(result.filePaths);});
});
app.on('before-quit',()=>{updates?.stop();discovery?.cancel();playbackTracker?.stop();try{playbackStore?.finish(playerState);}catch{}try{musicGraph?.close();}catch{}quitting=true;});app.on('window-all-closed',()=>app.quit());

}

function registerDiscovery() {
 const network = session.fromPartition('discovery-readonly');
 try {
  musicGraph = openMusicGraph({
   profileDir: profileData,
   legacyFeedbackFile: path.join(profileData, 'discovery-feedback.json'),
   diagnostics,
  });
 } catch (error) {
  diagnostics.add('music-graph', { stage: 'initialization-failed', code: String(error?.code || 'internal') });
  musicGraph = null;
 }
 playbackTracker = createPlaybackTracker((event) => { musicGraph?.recordPlayback(event); });
 const catalogScope = () => {
  const profile = accountSession?.profile;
  const identity = profile?.id ?? profile?.user_id ?? profile?.userId ?? profile?.username;
  if (identity === undefined || identity === null || identity === '') return 'anonymous';
  return crypto.createHash('sha256').update(String(identity)).digest('hex').slice(0, 24);
 };
 discovery = new Discovery({
  providers: createProviders(network.fetch.bind(network), { cache: musicGraph?.cache }),
  storage: createStorage(profileData, safeStorage),
  connected: () => Boolean(accountSession?.profile && api.token),
  searchZvuk: async (query, signal) => (await api.search(query, null, signal)).tracks,
  progress: (value) => { if (win && !win.isDestroyed()) win.webContents.send('discovery-progress', value); },
  graph: musicGraph,
  cache: musicGraph?.cache,
  catalogScope,
 });
 handle('discovery-identify', names => discovery.identify(names), 'main');
 handle('discovery-recommend', (ids, mode, count) => discovery.recommend(ids, mode, count), 'main');
 handle('discovery-cancel', () => { discovery.cancel(); return true; }, 'main');
 handle('discovery-vote', (id, vote) => discovery.saveFeedback(id, vote), 'main');
 handle('discovery-choose', (id, track) => discovery.choose(id, track), 'main');
 handle('discovery-export', async () => {
  const exportData = discovery.exportReport();
  const choice = await dialog.showSaveDialog(win, { defaultPath: 'Orbita-Discovery.json', filters: [{ name:'JSON', extensions:['json'] }] });
  if (choice.canceled || !choice.filePath) return false;
  await fs.promises.writeFile(choice.filePath, JSON.stringify(exportData, null, 2) + '\n', 'utf8');
  return true;
 }, 'main');
 for (const action of ['info', 'save', 'check', 'remove']) {
  handle('discovery-token-' + action, value => discovery.credential(action, value), 'settings');
 }
 handle('music-graph-stats', () => musicGraph ? musicGraph.stats() : {
  available: false, schemaVersion: 0, file: 'music-graph.sqlite', dbSizeBytes: 0,
  counts: { artists: 0, recordings: 0, releaseGroups: 0, releases: 0, releaseTracks: 0, tags: 0, relations: 0, mappings: 0, ratings: 0, events: 0 },
  cache: { hits: 0, misses: 0, writes: 0, evictions: 0, entries: 0 },
  lastUpdated: null, recovered: false, error: 'graph-unavailable',
 }, 'settings');
 handle('music-graph-clear-cache', () => musicGraph ? musicGraph.clearCache() : { cleared: 0, error: 'graph-unavailable' }, 'settings');
}
