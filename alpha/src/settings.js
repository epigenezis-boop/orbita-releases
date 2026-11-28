const $=id=>document.getElementById(id);async function call(n,...a){const r=await window.settings.call(n,...a);if(!r.ok)throw Error(r.error);return r.value;}function theme(t){document.documentElement.dataset.theme=t;document.querySelectorAll('[data-theme]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.theme===t)));}window.settings.onTheme(theme);call('theme-get').then(theme);const status=s=>{$('authStatus').hidden=false;$('authStatus').textContent=OrbitaI18n.message(s);};document.querySelectorAll('button[data-theme]').forEach(b=>b.onclick=()=>call('theme-set',b.dataset.theme).catch(e=>status(e.message)));$('openLogin').onclick=()=>call('auth-open').catch(e=>status(e.message));async function connect(token){const buttons=Array.from(document.querySelectorAll('.loginActions button,#connectToken'));buttons.forEach(b=>b.disabled=true);status(OrbitaI18n.t('Проверяю аккаунт…'));try{await call('connect',token);$('token').value='';status(OrbitaI18n.t('Аккаунт подключён. Коллекция обновляется в плеере.'));}catch(e){status(e.message);}finally{buttons.forEach(b=>b.disabled=false);}}$('connect').onclick=()=>connect($('token').value.trim()||undefined);$('connectToken').onclick=()=>{$('token').value.trim()?connect($('token').value.trim()):status(OrbitaI18n.t('Вставь токен.'));};$('logout').onclick=async()=>{const b=$('logout');if(b.disabled)return;b.disabled=true;try{await call('logout');status(OrbitaI18n.t('Сессия удалена.'));}catch(e){status(e.message);}finally{b.disabled=false;}};call('restore').then(p=>status(p?OrbitaI18n.t('Аккаунт подключён'):OrbitaI18n.t('Подключи аккаунт Звука'))).catch(e=>status(e.message));
$('diagnosticsExport').onclick=async()=>{try{$('diagnosticsStatus').textContent=await call('diagnostics-export')?OrbitaI18n.t('Отчёт сохранён. Его можно приложить к сообщению.'):OrbitaI18n.t('Сохранение отменено.');}catch(e){$('diagnosticsStatus').textContent=OrbitaI18n.message(e.message);}};

call('normalization-get').then(v=>{$('normalizationEnabled').checked=v;}).catch(e=>{$('normalizationStatus').textContent=OrbitaI18n.message(e.message);});
$('normalizationEnabled').onchange=async()=>{const b=$('normalizationEnabled'),wanted=b.checked;b.disabled=true;try{await call('normalization-set',wanted);$('normalizationStatus').textContent=wanted?OrbitaI18n.t('Автоматическое выравнивание включено.'):OrbitaI18n.t('Выравнивание выключено.');}catch(e){b.checked=!wanted;$('normalizationStatus').textContent=OrbitaI18n.message(e.message);}finally{b.disabled=false;}};

$('retryAudio').onclick=async()=>{const b=$('retryAudio');b.disabled=true;try{await call('stream-unblock');status(OrbitaI18n.t('Повтор разрешён. Вернись в плеер и включи один трек. Вход в аккаунт не выполнялся.'));}catch(e){status(e.message);}finally{b.disabled=false;}};

call('quality-get').then(q=>{$('streamQuality').value=q;}).catch(e=>{$('qualityStatus').textContent=OrbitaI18n.message(e.message);});
$('streamQuality').onchange=async()=>{const b=$('streamQuality');b.disabled=true;try{await call('quality-set',b.value);$('qualityStatus').textContent=OrbitaI18n.t('Сохранено. Настройка применяется к воспроизводимому потоку.');}catch(e){$('qualityStatus').textContent=OrbitaI18n.message(e.message);}finally{b.disabled=false;}};

let latestUpdates;function renderUpdates(s){latestUpdates=s;
 $('updateVersion').textContent=OrbitaI18n.t('Версия ')+s.version+OrbitaI18n.t(' · Orbita со Звуком');$('updateAutomatic').checked=s.automatic;$('updateAutomatic').disabled=!s.supported;
 const messages={unsupported:OrbitaI18n.t('Автообновления доступны в установленной версии Orbita для Windows.'),idle:s.checkedAt?OrbitaI18n.t('У тебя актуальная версия.'):OrbitaI18n.t('Обновления проверяются в фоне.'),checking:OrbitaI18n.t('Проверяю обновления…'),available:OrbitaI18n.t('Доступна версия ')+s.availableVersion+'.',downloading:OrbitaI18n.t('Загружаю версию ')+s.availableVersion+' — '+s.progress+'%.',downloaded:OrbitaI18n.t('Версия ')+s.availableVersion+OrbitaI18n.t(' готова. Установится при полном выходе из Orbita.'),error:s.error};
 $('updateStatus').textContent=OrbitaI18n.message(messages[s.status]||'');$('updateCheck').disabled=!s.supported||['checking','downloading','downloaded'].includes(s.status);
 $('updateDownload').hidden=!s.availableVersion||!['available','error'].includes(s.status);$('updateInstall').hidden=s.status!=='downloaded';
}
window.settings.onUpdates?.(renderUpdates);call('updates-get').then(renderUpdates).catch(()=>{$('updateStatus').textContent=OrbitaI18n.t('Не удалось прочитать настройки обновлений.');});
for(const [id,channel] of [['updateCheck','updates-check'],['updateDownload','updates-download'],['updateInstall','updates-install']])$(id).onclick=async()=>{try{const result=await call(channel);if(result&&typeof result==='object')renderUpdates(result);}catch{$('updateStatus').textContent=OrbitaI18n.t('Не удалось выполнить действие. Повтори позже.');}};
$('updateAutomatic').onchange=async()=>{const b=$('updateAutomatic');b.disabled=true;try{renderUpdates(await call('updates-auto',b.checked));}catch{b.checked=!b.checked;$('updateStatus').textContent=OrbitaI18n.t('Не удалось сохранить настройку.');}finally{b.disabled=false;}};

$('appLanguage').value=OrbitaI18n.getLanguage();
$('appLanguage').onchange=async()=>{const select=$('appLanguage'),before=OrbitaI18n.getLanguage();select.disabled=true;try{await call('language-set',select.value);}catch{select.value=before;$('languageStatus').textContent=OrbitaI18n.t('Не удалось сохранить язык.');}finally{select.disabled=false;}};
window.addEventListener('orbita-language',()=>{$('appLanguage').value=OrbitaI18n.getLanguage();if(latestUpdates)renderUpdates(latestUpdates);for(const id of ['authStatus','diagnosticsStatus','normalizationStatus','qualityStatus','widgetStatus'])$(id).textContent=OrbitaI18n.message($(id).textContent);});

function paintWidgetPrefs(s){$('widgetOnTop').checked=s.alwaysOnTop;$('widgetRemember').checked=s.rememberPosition;}
call('widget-get').then(paintWidgetPrefs).catch(()=>{});
for(const id of ['widgetOnTop','widgetRemember'])$(id).onchange=async()=>{
 const inputs=[$('widgetOnTop'),$('widgetRemember')];inputs.forEach(b=>b.disabled=true);
 try{paintWidgetPrefs(await call('widget-set',{alwaysOnTop:inputs[0].checked,rememberPosition:inputs[1].checked}));$('widgetStatus').textContent=OrbitaI18n.t('Настройки виджета сохранены.');}
 catch(e){$('widgetStatus').textContent=OrbitaI18n.message(e.message);call('widget-get').then(paintWidgetPrefs).catch(()=>{});}
 finally{inputs.forEach(b=>b.disabled=false);}
};
