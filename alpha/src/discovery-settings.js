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
  void attempt('info');
})();
