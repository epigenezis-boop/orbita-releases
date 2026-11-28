# Orbita Alpha

Каталог `alpha/` содержит версионируемый исходный код Electron-издания 2.0. База была извлечена штатным `tools/assemble.mjs` из стабильного payload 1.8.0. Сборка Alpha использует свой npm-манифест и lock-файл. `tools/assemble.mjs` по-прежнему восстанавливает стабильную базу в `app/`.

## Сборка и проверка на Windows

Используй Node.js 22 и PowerShell. Из корня репозитория:

```powershell
Push-Location alpha
npm.cmd ci --no-audit --no-fund
npx.cmd playwright install chromium
npm.cmd test
npm.cmd run test:ui
npm.cmd run test:audio
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'
npm.cmd run package:win
Pop-Location
./tools/verify-manifest.ps1 -Path alpha/dist/Orbita-Alpha-Setup-2.0.0-alpha.1-x64.exe
./tools/verify-manifest.ps1 -Path 'alpha/dist/win-unpacked/Orbita Alpha.exe'
Get-FileHash -Algorithm SHA256 alpha/dist/Orbita-Alpha-Setup-2.0.0-alpha.1-x64.exe
```

`npm test` выполняет независимую сверку уровня громкости, если в `PATH` есть FFmpeg с фильтром `ebur128`. Для запуска исходников используй `npm.cmd start` из `alpha/`. Установленная Alpha и режим разработки используют `%APPDATA%\orbita-player-alpha`.

NSIS устанавливает Alpha для текущего пользователя в `%LOCALAPPDATA%\Programs\orbita-player-alpha`. Имя приложения и записи удаления — Orbita Alpha, app ID — `Orbita.Player.Alpha`. Профиль и блокировка экземпляра отделены от стабильной Orbita. Updater выключен в main, а `build.publish: null` исключает `app-update.yml` и `latest.yml` из новой сборки. Проверяй эти файлы в чистом выводе упаковщика. Публикация установщика не входит в `package:win`.

## Discovery

Открой Discovery в боковой панели Classic. Найди до четырёх исполнителей по имени или MBID и выбери нужные варианты. Затем выбери режим и размер подборки. Публичное ListenBrainz Radio работает без токена. Если сервис потребует авторизацию, настрой токен в разделе ListenBrainz настроек Alpha. Приложение проверяет токен через ListenBrainz и сохраняет его в Electron `safeStorage` под Windows. Результат проверки содержит только состояние подключения.

Для сопоставления и воспроизведения подключи Звук в настройках Alpha. Приложение использует существующий каталог и поиск Звука. Если данных недостаточно для уверенного выбора, карточка показывает варианты версии. Сопоставленные треки используют существующие действия плеера, очереди и навигации по альбомам и исполнителям. Обложки берутся из Звука. Оценки остаются в профиле Alpha. Экспорт JSON содержит метаданные, IDs, основания сопоставления и оценки. В нём отсутствуют токены, данные сессии и URL обложек или потоков.

`src/discovery/providers.cjs` обслуживает read-only API ListenBrainz и MusicBrainz через системную сеть Electron. `model.cjs` разделяет запись, релиз, группу релизов, кредиты исполнителя и соответствие каталогу Звука. `service.cjs` координирует запросы, отмену, кэш, оценки и экспорт. UI обращается к сервису через IPC, а для воспроизведения использует существующий плеер. Эти границы позволяют подключать альбомные рекомендации и локальный каталог независимо от оформления.
