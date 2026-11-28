'use strict';

const DiscoveryUI = (() => {
  const panel = $('discoveryPanel');
  const submit = $('discoveryFind');
  const generate = $('discoveryGenerate');
  const cancelButton = $('discoveryCancel');
  const exportButton = $('discoveryExport');
  const choices = $('discoveryChoices');
  const results = $('discoveryResults');
  const { pair, error: errorCopy } = DiscoveryCopy;
  const fields = [...panel.querySelectorAll('[data-seed]')];
  let artists = [];
  let selected = [];
  let report = null;
  let busy = false;
  let operation = 0;
  let status = () => '';

  function setStatus(format) {
    status = format;
    $('discoveryStatus').textContent = format();
  }

  function controls() {
    for (const field of fields) field.disabled = busy;
    for (const select of choices.querySelectorAll('select')) select.disabled = busy;
    submit.disabled = busy;
    generate.disabled = busy || !selected.length || selected.some((id) => !id) ||
      new Set(selected).size !== selected.length;
    cancelButton.hidden = !busy;
    exportButton.hidden = !report?.candidates.length;
  }

  function cancel(announce = true) {
    if (!busy) return;
    operation++;
    busy = false;
    controls();
    if (announce) setStatus(() => errorCopy('cancelled'));
    void call('discovery-cancel').catch(() => {});
  }

  async function run(initial, work) {
    const id = ++operation;
    busy = true;
    controls();
    setStatus(initial);
    try {
      await work(() => id === operation);
    } catch (cause) {
      if (id === operation) setStatus(() => errorCopy(cause.message));
    } finally {
      if (id === operation) {
        busy = false;
        controls();
      }
    }
  }

  function action(ru, en, handler, className = '') {
    const b = element('button', className, pair(ru, en));
    b.type = 'button';
    b.onclick = async () => {
      b.disabled = true;
      try { await handler(); }
      catch (cause) { setStatus(() => errorCopy(cause.message)); }
      finally { b.disabled = false; }
    };
    return b;
  }

  function paintChoices() {
    choices.replaceChildren();
    artists.forEach(({ query, options, error }, i) => {
      const label = element('label', 'discoveryField');
      label.append(element('span', '', query));
      if (!options.length) {
        label.append(element('small', 'hint', error ? errorCopy(error) : pair('MusicBrainz не нашёл исполнителя.', 'MusicBrainz found no artist.')));
      } else {
        const select = element('select');
        const first = element('option', '', pair('Выбери исполнителя', 'Choose the artist'));
        first.value = '';
        select.append(first);
        for (const a of options) {
          const descriptor = [a.disambiguation, a.area || a.country, a.begin].filter(Boolean).join(' · ');
          const option = element('option', '', a.name + (descriptor ? ' — ' + descriptor : ' — ' + a.id));
          option.value = a.id;
          select.append(option);
        }
        select.value = selected[i] || '';
        select.onchange = () => { selected[i] = select.value; controls(); };
        label.append(select);
      }
      choices.append(label);
    });
    generate.hidden = !artists.length;
    controls();
  }

  function matchCopy(match) {
    switch (match.status) {
      case 'matched': return pair('Найдено в Звуке', 'Found on Zvuk');
      case 'review': return pair('Проверь версию в Звуке', 'Review versions on Zvuk');
      case 'connect-zvuk': return pair('Подключи Звук для поиска и воспроизведения', 'Connect Zvuk to match and play');
      case 'metadata-unavailable': return pair('Метаданные MusicBrainz недоступны', 'MusicBrainz metadata unavailable');
      case 'catalog-unavailable': return pair('Поиск в Звуке недоступен', 'Zvuk search unavailable');
      default: return pair('Не найдено в Звуке', 'Not found on Zvuk');
    }
  }

  function confidenceCopy(confidence) {
    switch (confidence) {
      case 'identifier': return pair('По идентификатору', 'Matched by identifier');
      case 'metadata': return pair('Название, исполнитель, альбом и длительность', 'Title, artist, album and duration');
      case 'confirmed': return pair('Версия подтверждена вручную', 'Version confirmed manually');
      default: return pair('Требуется выбор версии', 'Version needs review');
    }
  }

  function describeMatch(entry) {
    const { track } = entry;
    return [track.title, track.artist, track.album, track.duration > 0 ? time(track.duration) : ''].filter(Boolean).join(' · ');
  }

  function detailsFor(candidate) {
    const { recording, match } = candidate;
    const details = element('details', 'discoveryDetails');
    details.append(element('summary', '', pair('Источники и сопоставление', 'Sources and matching')));
    details.append(element('p', '', 'ListenBrainz Radio · MusicBrainz · ' + (recording?.id || candidate.id)));
    if (candidate.listenCount !== null) {
      details.append(element('p', '', pair('Прослушивания в ListenBrainz: ', 'ListenBrainz listens: ') + candidate.listenCount));
    }
    if (recording?.isrcs.length) details.append(element('p', '', 'ISRC · ' + recording.isrcs.join(', ')));
    const records = recording?.releaseGroups.length ? recording.releaseGroups : recording?.releases;
    if (records?.length) {
      const editions = element('ul');
      for (const release of records) {
        editions.append(element('li', '', [release.title, release.firstReleaseDate || release.date, release.id].filter(Boolean).join(' · ')));
      }
      details.append(editions);
    }
    if (match.choice) details.append(element('p', '', confidenceCopy(match.choice.confidence)));
    if (match.options.length) {
      for (const entry of match.options) {
        const option = element('div', 'discoveryOption');
        option.append(element('span', '', describeMatch(entry)));
        option.append(action('Выбрать версию', 'Select version', async () => {
          const track = await call('discovery-choose', candidate.id, entry.track.id);
          candidate.match = { status: 'matched', choice: { ...entry, track, confidence: 'confirmed' }, options: [] };
          const card = renderCandidate(candidate);
          results.querySelector('[data-recording="' + candidate.id + '"]').replaceWith(card);
          card.querySelector('.discoveryActions button')?.focus();
        }));
        details.append(option);
      }
      details.open = true;
    }
    return details;
  }

  function renderCandidate(candidate) {
    const { recording, match } = candidate;
    const target = match.choice?.track;
    const row = element('article', 'discoveryCard');
    row.dataset.recording = candidate.id;
    row.append(cover(target?.cover));
    const body = element('div', 'discoveryCardBody');
    const album = target?.album || recording?.releaseGroups[0]?.title || recording?.releases[0]?.title;
    body.append(element('h3', '', recording?.title || pair('Запись ', 'Recording ') + candidate.id));
    body.append(element('p', '', [recording?.artistCredit || candidate.artistName, album,
      recording?.durationMs ? time(recording.durationMs / 1000) : ''].filter(Boolean).join(' · ')));
    body.append(element('p', 'hint', matchCopy(match)));

    const actions = element('div', 'discoveryActions');
    if (target) {
      const select = () => call('discovery-choose', candidate.id, target.id);
      actions.append(
        action('Слушать', 'Play', async () => {
          const track = await select();
          stopWave();
          playAt(enqueue(track, true));
        }, 'primary'),
        action('В очередь', 'Queue', async () => enqueue(await select())),
      );
      if (target.albumId) actions.append(action('Альбом', 'Album', async () => openAlbum(await select())));
      const artists = target.artists || [];
      for (const a of artists) {
        actions.append(action(artists.length === 1 ? 'Исполнитель' : a.title, artists.length === 1 ? 'Artist' : a.title,
          async () => { await select(); return openArtist(a); }));
      }
    }
    const votes = [
      ['like', 'Нравится', 'Like'],
      ['dislike', 'Не нравится', 'Dislike'],
    ].map(([vote, ru, en]) => {
      const button = action(ru, en, async () => {
        candidate.feedback = await call('discovery-vote', candidate.id, candidate.feedback === vote ? null : vote);
        votes.forEach(([key, control]) => control.setAttribute('aria-pressed', String(candidate.feedback === key)));
      });
      button.setAttribute('aria-pressed', String(candidate.feedback === vote));
      return [vote, button];
    });
    actions.append(...votes.map(([, button]) => button));
    body.append(actions, detailsFor(candidate));
    row.append(body);
    return row;
  }

  function paintResults() {
    results.replaceChildren();
    const list = $('discoveryNotices');
    list.replaceChildren();
    if (!report) return;
    for (const code of report.notices) list.append(element('li', '', errorCopy(code)));
    for (const candidate of report.candidates) results.append(renderCandidate(candidate));
  }

  $('discoveryForm').onsubmit = (event) => {
    event.preventDefault();
    if (busy) return;
    const names = fields.map((field) => field.value.trim()).filter(Boolean);
    if (!names.length) return;
    artists = [];
    selected = [];
    paintChoices();
    void run(() => pair('Ищу исполнителей в MusicBrainz…', 'Looking up artists in MusicBrainz…'), async (current) => {
      const response = await call('discovery-identify', names);
      if (!current()) return;
      artists = response;
      selected = artists.map(({ options }) => options.length === 1 ? options[0].id : '');
      paintChoices();
      setStatus(() => artists.some(({ options }) => options.length === 0)
        ? pair('Уточни имена или введи MBID, затем повтори поиск.', 'Refine the names or enter MBIDs, then search again.')
        : pair('Подтверди исполнителей и получи подборку.', 'Confirm the artists, then generate recommendations.'));
      choices.querySelector('select')?.focus();
    });
  };

  for (const field of fields) {
    field.oninput = () => {
      if (!artists.length) return;
      artists = [];
      selected = [];
      paintChoices();
      setStatus(() => '');
    };
  }

  generate.onclick = () => {
    if (busy || generate.disabled) return;
    report = null;
    paintResults();
    void run(() => pair('Запрашиваю ListenBrainz Radio…', 'Requesting ListenBrainz Radio…'), async (current) => {
      const value = await call('discovery-recommend', selected, $('discoveryMode').value, Number($('discoveryCount').value));
      if (!current()) return;
      report = value;
      paintResults();
      setStatus(() => report.candidates.length
        ? pair('Записей в подборке: ', 'Recordings found: ') + report.candidates.length
        : pair('ListenBrainz не нашёл записей. Попробуй других исполнителей или режим.',
          'ListenBrainz returned no recordings. Try other artists or a different mode.'));
    });
  };

  cancelButton.onclick = () => cancel();
  exportButton.onclick = async () => {
    exportButton.disabled = true;
    try {
      if (await call('discovery-export')) setStatus(() => pair('Отчёт сохранён.', 'Report saved.'));
    } catch (cause) { setStatus(() => errorCopy(cause.message)); }
    finally { exportButton.disabled = false; }
  };
  window.desktop.onDiscoveryProgress?.((progress) => {
    if (!busy || progress.stage !== 'details') return;
    setStatus(() => pair('Уточняю данные и ищу в Звуке: ', 'Enriching metadata and matching on Zvuk: ') +
      progress.done + ' / ' + progress.total);
  });

  window.addEventListener('orbita-language', () => {
    setStatus(status);
    paintChoices();
    paintResults();
  });

  $('discoveryNav').onclick = () => {
    showView('discovery', 'Discovery', 'ListenBrainz Radio');
    visible = [];
    render();
    panel.scrollIntoView({ block: 'nearest' });
  };
  return { cancel };
})();
