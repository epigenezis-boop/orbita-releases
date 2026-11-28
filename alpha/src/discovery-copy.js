'use strict';

const DiscoveryCopy = (() => {
  const providers = { musicbrainz: 'MusicBrainz', listenbrainz: 'ListenBrainz', zvuk: 'Звук' };
  const errors = {
    'cancelled': ['Поиск отменён.', 'Search cancelled.'],
    'network': ['Проверь подключение к сети или системный прокси.', 'Check your network or system proxy.'],
    'timeout': ['Сервис не ответил вовремя. Повтори позже.', 'The service timed out. Try again later.'],
    'rate-limited': ['Сервис ограничил частоту запросов. Подожди и повтори.', 'Rate limit reached. Wait before trying again.'],
    'unavailable': ['Сервис временно недоступен. Повтори позже.', 'The service is temporarily unavailable. Try again later.'],
    'invalid-response': ['Сервис вернул ответ неизвестного формата.', 'The service returned an unexpected response.'],
    'request-rejected': ['Сервис отклонил запрос.', 'The service rejected the request.'],
    'token-required': ['Нужен токен. Добавь его в настройках Orbita Alpha.', 'A token is required. Add it in Orbita Alpha settings.'],
    'denied': ['Сервис отклонил авторизацию. Проверь подключение в настройках.', 'Authorization was rejected. Check the connection in settings.'],
    'verification': ['Звук запросил проверку сайта. Открой настройки и подключи сессию.', 'Zvuk requested website verification. Open settings and reconnect your session.'],
    'invalid-token': ['Токен не принят. Проверь его в настройках ListenBrainz.', 'The token was rejected. Check it in ListenBrainz settings.'],
    'secure-storage-unavailable': ['Защищённое хранилище недоступно. Сохранение токена отключено.', 'Secure storage is unavailable. Saving tokens is disabled.'],
    'credential-storage': ['Не удалось прочитать или сохранить защищённый токен.', 'Could not read or save the encrypted token.'],
    'credential-busy': ['Дождись завершения проверки.', 'Wait until the connection check finishes.'],
    'feedback-storage': ['Не удалось прочитать или сохранить локальные оценки.', 'Could not read or save local feedback.'],
    'invalid-seeds': ['Укажи от одного до четырёх разных исполнителей.', 'Choose one to four distinct artists.'],
    'invalid-track': ['Этот вариант больше недоступен. Обнови подборку.', 'This match is no longer available. Refresh the recommendations.'],
    'no-report': ['Сначала получи подборку.', 'Generate recommendations first.'],
    'internal': ['Действие не завершено. Повтори позже.', 'The action could not be completed. Try again later.'],
  };

  function pair(ru, en) { return OrbitaI18n.getLanguage() === 'en' ? en : ru; }

  function error(value) {
    const [first, second] = String(value).split(':', 2);
    const provider = second && providers[first] ? pair(providers[first], first === 'zvuk' ? 'Zvuk' : providers[first]) : '';
    const message = pair(...(errors[provider ? second : first] || errors.internal));
    return provider ? provider + ' · ' + message : message;
  }

  return { pair, error };
})();
