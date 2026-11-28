'use strict';

(() => {
  const field = $('discoveryToken');
  const save = $('discoveryTokenSave');
  const check = $('discoveryTokenCheck');
  const remove = $('discoveryTokenRemove');
  const out = $('discoveryTokenStatus');
  const { pair, error: errorCopy } = DiscoveryCopy;
  let info = null;
  let busy = false;
  let lastError = '';

  function render() {
    field.disabled = busy || !info?.secure;
    save.disabled = field.disabled;
    check.disabled = busy || !info?.configured || !info.secure;
    remove.disabled = busy || !info?.configured;
    if (busy) out.textContent = pair('Проверяю ListenBrainz…', 'Checking ListenBrainz…');
    else if (lastError) out.textContent = errorCopy(lastError);
    else if (!info) out.textContent = '';
    else if (!info.secure) out.textContent = errorCopy('secure-storage-unavailable');
    else if (info.status === 'connected') out.textContent = pair('ListenBrainz подключён.', 'ListenBrainz connected.');
    else if (info.configured) out.textContent = pair('Токен сохранён в защищённом хранилище.', 'Token saved in secure storage.');
    else out.textContent = pair('Токен не добавлен. Публичное радио доступно без него.', 'No token saved. Public radio works without one.');
  }

  async function attempt(action, value) {
    if (busy) return;
    busy = true;
    lastError = '';
    render();
    try {
      info = await call('discovery-token-' + action, value);
    } catch (cause) {
      lastError = cause.message;
    } finally {
      busy = false;
      render();
    }
  }

  save.onclick = () => {
    const token = field.value.trim();
    field.value = '';
    void attempt('save', token);
  };
  check.onclick = () => attempt('check');
  remove.onclick = () => { field.value = ''; return attempt('remove'); };
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !save.disabled) save.click();
  });
  window.addEventListener('orbita-language', render);

  const graphTitle = $('musicGraphTitle');
  const graphSummary = $('musicGraphSummary');
  const graphStatus = $('musicGraphStatus');
  const graphCache = $('musicGraphCache');
  const graphSchema = $('musicGraphSchema');
  const graphUpdated = $('musicGraphUpdated');
  const graphRefresh = $('musicGraphRefresh');
  const graphClear = $('musicGraphClearCache');
  const graphLabelNodes = Array.from(document.querySelectorAll('[data-graph-label]'));
  const graphValueNodes = {
    artists: $('musicGraphArtists'),
    recordings: $('musicGraphRecordings'),
    releaseGroups: $('musicGraphReleaseGroups'),
    releases: $('musicGraphReleases'),
    relations: $('musicGraphRelations'),
    mappings: $('musicGraphMappings'),
    events: $('musicGraphEvents'),
    dbSize: $('musicGraphDbSize')
  };
  const graphLabelCopy = {
    artists: ['Исполнители', 'Artists'],
    recordings: ['Записи', 'Recordings'],
    releaseGroups: ['Альбомы', 'Albums'],
    releases: ['Издания', 'Releases'],
    relations: ['Связи', 'Relations'],
    mappings: ['Сопоставления со Звуком', 'Zvuk matches'],
    events: ['Пользовательские события', 'User events'],
    dbSize: ['Размер базы', 'Database size']
  };
  let graphStats = null;
  let graphBusy = false;
  let graphLoadCode = '';
  let graphActionCode = '';
  let graphCleared = null;

  function graphLocale() {
    return OrbitaI18n.getLanguage() === 'en' ? 'en-GB' : 'ru-RU';
  }

  function graphInt(value) {
    if (value === null || value === undefined || value === '') return '—';
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    try {
      return new Intl.NumberFormat(graphLocale()).format(number);
    } catch {
      return String(number);
    }
  }

  function graphBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes < 0) return '—';
    const megabytes = bytes >= 1048576;
    const size = megabytes ? bytes / 1048576 : bytes / 1024;
    return (Math.round(size * 10) / 10).toFixed(1) + ' ' + pair(megabytes ? 'МБ' : 'КБ', megabytes ? 'MB' : 'KB');
  }

  function graphDate(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    try {
      return date.toLocaleString(graphLocale(), { dateStyle: 'short', timeStyle: 'short' });
    } catch {
      return date.toISOString();
    }
  }

  function graphCode(value) {
    const raw = typeof value === 'string' ? value : value && value.message;
    const first = String(raw || '').split(':')[0].trim();
    return /^[a-z][a-z0-9._-]{0,39}$/i.test(first) ? first : 'internal';
  }

  function renderGraph() {
    const available = graphStats?.available === true && !graphLoadCode;
    const counts = (available && graphStats.counts) || {};
    const cache = (available && graphStats.cache) || {};
    graphTitle.textContent = pair('Музыкальная база', 'Music graph');
    for (const label of graphLabelNodes) {
      const copy = graphLabelCopy[label.dataset.graphLabel];
      if (copy) label.textContent = pair(copy[0], copy[1]);
    }
    graphRefresh.disabled = graphBusy;
    graphClear.disabled = graphBusy || !available;
    for (const [key, node] of Object.entries(graphValueNodes)) {
      if (key === 'dbSize') node.textContent = available ? graphBytes(graphStats.dbSizeBytes) : '—';
      else node.textContent = available ? graphInt(counts[key]) : '—';
    }
    if (graphLoadCode) {
      graphSummary.textContent = pair('Музыкальная база недоступна', 'Music graph is unavailable') + ' · ' + graphLoadCode;
    } else if (available) {
      graphSummary.textContent = pair('Локальная база знаний о музыке. Показаны только сводные счётчики, без записей и идентификаторов.', 'Local music knowledge base. Only aggregate counters are shown, without rows or identifiers.');
    } else {
      graphSummary.textContent = '';
    }
    if (available) {
      graphCache.textContent = pair(
        'Кэш: попадания ' + graphInt(cache.hits) + ' · промахи ' + graphInt(cache.misses) + ' · записи ' + graphInt(cache.writes) + ' · элементов ' + graphInt(cache.entries),
        'Cache: ' + graphInt(cache.hits) + ' hits · ' + graphInt(cache.misses) + ' misses · ' + graphInt(cache.writes) + ' writes · ' + graphInt(cache.entries) + ' entries'
      );
      const meta = [];
      if (graphStats.schemaVersion != null) meta.push(pair('Схема v', 'Schema v') + graphInt(graphStats.schemaVersion));
      if (cache.entries != null) meta.push(pair('Размер кэша: ', 'Cache size: ') + graphInt(cache.entries) + ' ' + pair('записей', 'entries'));
      graphSchema.textContent = meta.join(' · ');
      const updated = graphDate(graphStats.lastUpdated);
      graphUpdated.textContent = updated ? pair('Обновлено: ', 'Updated: ') + updated : '';
    } else {
      graphCache.textContent = '';
      graphSchema.textContent = '';
      graphUpdated.textContent = '';
    }
    if (graphBusy) graphStatus.textContent = pair('Обновляю статистику…', 'Refreshing statistics…');
    else if (graphActionCode) graphStatus.textContent = errorCopy(graphActionCode) + ' · ' + graphActionCode;
    else if (graphCleared !== null) graphStatus.textContent = pair('Кэш очищен: ' + graphInt(graphCleared), 'Cache cleared: ' + graphInt(graphCleared));
    else graphStatus.textContent = '';
  }

  async function loadGraph() {
    if (graphBusy) return;
    graphBusy = true;
    graphLoadCode = '';
    graphActionCode = '';
    graphCleared = null;
    renderGraph();
    try {
      const stats = await call('music-graph-stats');
      graphStats = stats && typeof stats === 'object' ? stats : null;
      if (!graphStats || graphStats.available !== true) {
        graphLoadCode = graphStats && graphStats.error ? graphCode(graphStats.error) : 'graph-unavailable';
      }
    } catch (cause) {
      graphStats = null;
      graphLoadCode = graphCode(cause);
    } finally {
      graphBusy = false;
      renderGraph();
    }
  }

  async function clearGraphCache() {
    if (graphBusy || graphStats?.available !== true) return;
    graphBusy = true;
    graphActionCode = '';
    graphCleared = null;
    renderGraph();
    try {
      const result = await call('music-graph-clear-cache');
      const cleared = Number(result?.cleared);
      if (result?.stats && typeof result.stats === 'object') graphStats = result.stats;
      if (graphStats?.available !== true) {
        graphLoadCode = graphStats && graphStats.error ? graphCode(graphStats.error) : 'graph-unavailable';
        graphCleared = null;
      } else {
        graphLoadCode = '';
        graphCleared = Number.isFinite(cleared) && cleared >= 0 ? cleared : 0;
      }
    } catch (cause) {
      graphActionCode = graphCode(cause);
    } finally {
      graphBusy = false;
      renderGraph();
    }
  }

  graphRefresh.onclick = () => { void loadGraph(); };
  graphClear.onclick = () => { void clearGraphCache(); };
  window.addEventListener('orbita-language', renderGraph);
  void loadGraph();
  void attempt('info');
})();
