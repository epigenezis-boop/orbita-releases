'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { openMusicGraph } = require('../src/graph/index.cjs');
const { openGraphDatabase } = require('../src/graph/database.cjs');
const { GraphRepository } = require('../src/graph/repository.cjs');
const { createPlaybackTracker } = require('../src/graph/playback.cjs');
const { createProviders } = require('../src/discovery/providers.cjs');
const { Discovery } = require('../src/discovery/service.cjs');
const { recording } = require('../src/discovery/model.cjs');

const nightwish = '00a9f935-ba93-4fc8-a33a-993abe9c936b';
const epica = '21985b14-1b0d-44fe-b357-310b29bba510';
const recordingId = '55fda018-552c-4616-aced-2b4f7065e4a7';
const releaseId = '76d7a3b7-cf35-409f-9eb5-36d42fcae28b';
const groupId = 'c32724fe-9b96-3e3a-b687-fc76b1bcbe25';

const crownless = {
  id: recordingId, title: 'Crownless', length: 269000, isrcs: ['FISFS0000087'],
  genres: [{ name: 'Symphonic Metal' }], tags: [{ name: 'female vocals' }],
  'artist-credit': [{ name: 'Nightwish', artist: { id: nightwish, name: 'Nightwish' } }],
  releases: [{ id: releaseId, title: 'Wishmaster', date: '2000',
    'release-group': { id: groupId, title: 'Wishmaster', 'primary-type': 'Album' } }],
};

function fixtureReport(overrides = {}) {
  const metadata = recording(crownless, { artistName: 'Nightwish' });
  return {
    schema: 1, generatedAt: new Date().toISOString(), seedIds: [epica], mode: 'medium', requested: 10,
    source: 'listenbrainz-radio', metadataSource: 'musicbrainz', artworkSource: 'zvuk', notices: [],
    candidates: [{
      id: recordingId, artistId: nightwish, artistName: 'Nightwish', seedArtistIds: [epica],
      listenCount: 42, recording: metadata, feedback: 'like',
      match: { status: 'matched', choice: { track: { id: '83', title: 'Crownless', artist: 'Nightwish',
        album: 'Wishmaster', albumId: '5', duration: 270, confidence: 'metadata' }, confidence: 'metadata' }, options: [] },
    }],
    ...overrides,
  };
}

function seededGraph(t) {
  const profile = mkdtempSync(path.join(tmpdir(), 'orbita-graph-test-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const graph = openMusicGraph({ profileDir: profile });
  assert.equal(graph.available, true);
  return { profile, graph };
}

test('graph persists entities, links, ratings, mappings and survives restart without duplicates', (t) => {
  const { profile, graph } = seededGraph(t);
  assert.equal(graph.rememberArtists([{ id: epica, name: 'Epica' }]), 1);
  const first = graph.recordReport(fixtureReport(), [{ id: epica, name: 'Epica' }]);
  assert.equal(first.stored, true);
  assert.equal(first.candidates, 1);
  const counts = graph.stats().counts;
  assert.equal(counts.artists, 2);
  assert.equal(counts.recordings, 1);
  assert.equal(counts.releaseGroups, 1);
  assert.equal(counts.releases, 1);
  assert.equal(counts.relations, 6);
  assert.equal(counts.tags, 2);
  assert.equal(counts.mappings, 1);
  assert.equal(counts.ratings, 1);
  assert.ok(graph.stats().dbSizeBytes > 0);

  // The same discovery result must update rows, not duplicate them.
  const second = graph.recordReport(fixtureReport(), [{ id: epica, name: 'Epica' }]);
  assert.equal(second.stored, true);
  const repeated = graph.stats().counts;
  for (const key of ['artists', 'recordings', 'releaseGroups', 'releases', 'tags', 'relations', 'mappings', 'ratings']) {
    assert.equal(repeated[key], counts[key], key);
  }
  graph.close();

  const reopened = openMusicGraph({ profileDir: profile });
  assert.equal(reopened.available, true);
  assert.deepEqual(reopened.stats().counts, repeated);
  assert.ok(reopened.stats().lastUpdated);
  // Confirmation counts must not grow just because the same report was stored twice.
  const mapping = reopened.stats().counts.mappings;
  assert.equal(mapping, 1);
  reopened.recordVote(recordingId, 'dislike');
  reopened.recordChoice(recordingId, { id: '83', albumId: '5' });
  reopened.close();
  const check = openGraphDatabase(path.join(profile, 'music-graph.sqlite'));
  assert.equal(check.prepare('SELECT title FROM recording WHERE mbid = ?').get(recordingId).title, 'Crownless');
  const kinds = Object.fromEntries(check.prepare('SELECT name, kind FROM tag').all().map((row) => [row.name, row.kind]));
  assert.equal(kinds['Symphonic Metal'], 'genre');
  assert.equal(kinds['female vocals'], 'tag');
  check.close();
});

test('cache stores only external payloads, reports hits, expires entries and never deletes graph knowledge', (t) => {
  const { profile, graph } = seededGraph(t);
  graph.recordReport(fixtureReport(), [{ id: epica, name: 'Epica' }]);
  const before = graph.stats().counts;

  assert.equal(graph.cache.put('musicbrainz', 'https://musicbrainz.test/ws/2/artist/x', '', { artists: [] }, 60_000, '/artist'), true);
  assert.deepEqual(graph.cache.get('musicbrainz', 'https://musicbrainz.test/ws/2/artist/x', ''), { artists: [] });
  assert.equal(graph.cache.get('musicbrainz', 'https://musicbrainz.test/missing', ''), null);
  const cache = graph.cache.stats();
  assert.equal(cache.hits, 1);
  assert.equal(cache.misses, 1);
  assert.equal(cache.writes, 1);
  assert.equal(cache.entries, 1);

  assert.equal(graph.cache.put('musicbrainz', 'https://musicbrainz.test/expired', '', { old: true }, 60_000), true);
  // Force expiry through the database to avoid waiting; cache.clear must still keep graph rows.
  const raw = openGraphDatabase(path.join(profile, 'music-graph.sqlite'));
  raw.prepare('UPDATE external_cache SET expires_at = 0 WHERE payload LIKE ?').run('%old%');
  raw.close();
  assert.equal(graph.cache.get('musicbrainz', 'https://musicbrainz.test/expired', ''), null);

  assert.equal(graph.cache.put('zvuk-search', 'q', 'scope', [{ id: '83', title: 'Crownless',
    cover: 'https://cdn.test/cover.jpg' }], 60_000, '/search'), true);
  assert.deepEqual(graph.cache.getSearch('scope', 'Q'), [{ id: '83', title: 'Crownless',
    cover: 'https://cdn.test/cover.jpg' }]);

  const cleared = graph.clearCache();
  assert.ok(cleared.cleared >= 1);
  assert.equal(graph.stats().cache.entries, 0);
  assert.deepEqual(graph.stats().counts, before);
  assert.equal(graph.stats().available, true);
  graph.close();
});

test('legacy Discovery votes migrate idempotently and the JSON file is preserved', (t) => {
  const { profile, graph: initial } = seededGraph(t);
  initial.close();
  const feedback = path.join(profile, 'discovery-feedback.json');
  writeFileSync(feedback, JSON.stringify({ schema: 1, votes: { [recordingId]: 'like', bad: 'like' } }));
  const original = readFileSync(feedback, 'utf8');

  let graph = openMusicGraph({ profileDir: profile, legacyFeedbackFile: feedback });
  assert.equal(graph.importedVotes, 1);
  assert.equal(graph.stats().counts.ratings, 1);
  graph.close();

  graph = openMusicGraph({ profileDir: profile, legacyFeedbackFile: feedback });
  assert.equal(graph.importedVotes, 1, 're-import is idempotent at the rating row level');
  assert.equal(graph.stats().counts.ratings, 1);
  assert.equal(readFileSync(feedback, 'utf8'), original);
  assert.equal(existsSync(feedback), true);
  graph.close();
});

test('a provider track maps to one recording and backfills earlier events', (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), 'orbita-graph-map-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const database = openGraphDatabase(path.join(profile, 'music-graph.sqlite'));
  const repository = new GraphRepository(database);
  const first = repository.upsertRecording({ mbid: recordingId, title: 'Crownless' });
  const secondId = '0b6ad0ba-2ef2-4d1f-9dee-0ca2f1d5c7cc';
  const second = repository.upsertRecording({ mbid: secondId, title: 'Second' });
  assert.equal(repository.recordPlayback({ type: 'play', trackId: '77', provider: 'zvuk',
    dedupeKey: 'play:77:1' }), true);
  repository.mapProvider({ entityType: 'recording', entityId: first, provider: 'zvuk',
    providerId: '77', basis: 'catalog-track', confidence: 'metadata' });
  repository.mapProvider({ entityType: 'recording', entityId: second, provider: 'zvuk',
    providerId: '77', basis: 'manual-choice', confidence: 'confirmed' });
  assert.equal(repository.counts().mappings, 1);
  assert.equal(repository.findMapping('recording', 'zvuk', '77').entity_id, second);
  const event = database.prepare("SELECT recording_id FROM user_event WHERE type = 'play'").get();
  assert.equal(event.recording_id, second);
  database.close();
});

test('playback dedupe keys stay unique across tracker and database restarts', (t) => {
  const { profile, graph: initial } = seededGraph(t);
  initial.close();
  let graph = openMusicGraph({ profileDir: profile });
  let tracker = createPlaybackTracker((event) => graph.recordPlayback(event));
  tracker.update({ trackId: '83', title: 'Crownless', artist: 'Nightwish', paused: false, time: 0, duration: 200 });
  tracker.stop();
  assert.equal(graph.stats().counts.events, 1);
  graph.close();

  graph = openMusicGraph({ profileDir: profile });
  tracker = createPlaybackTracker((event) => graph.recordPlayback(event));
  tracker.update({ trackId: '83', title: 'Crownless', artist: 'Nightwish', paused: false, time: 0, duration: 200 });
  tracker.stop();
  assert.equal(graph.stats().counts.events, 2, 'the new process must not collide with old keys');
  graph.close();
});

test('automatic reports cannot move a confirmed or stronger provider mapping', (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), 'orbita-graph-rank-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const database = openGraphDatabase(path.join(profile, 'music-graph.sqlite'));
  const repository = new GraphRepository(database);
  const first = repository.upsertRecording({ mbid: recordingId, title: 'Crownless' });
  const secondId = '0b6ad0ba-2ef2-4d1f-9dee-0ca2f1d5c7cc';
  const second = repository.upsertRecording({ mbid: secondId, title: 'Second' });

  repository.mapProvider({ entityType: 'recording', entityId: first, provider: 'zvuk',
    providerId: '83', basis: 'catalog-track', confidence: 'metadata', evidenceKey: 'report-a' });
  repository.recordChoice(recordingId, { id: '83' });
  assert.equal(repository.findMapping('recording', 'zvuk', '83').confidence, 'confirmed');
  repository.mapProvider({ entityType: 'recording', entityId: second, provider: 'zvuk',
    providerId: '83', basis: 'catalog-track', confidence: 'metadata', evidenceKey: 'report-b' });
  const kept = repository.findMapping('recording', 'zvuk', '83');
  assert.equal(kept.entity_id, first, 'confirmed mapping must not move to an automatic metadata match');
  assert.equal(kept.confidence, 'confirmed');

  // A strictly stronger identifier match may correct an older metadata mapping.
  repository.mapProvider({ entityType: 'recording', entityId: first, provider: 'zvuk',
    providerId: '84', basis: 'catalog-track', confidence: 'metadata', evidenceKey: 'report-c' });
  repository.mapProvider({ entityType: 'recording', entityId: second, provider: 'zvuk',
    providerId: '84', basis: 'catalog-track', confidence: 'identifier', evidenceKey: 'identifier-c' });
  const corrected = repository.findMapping('recording', 'zvuk', '84');
  assert.equal(corrected.entity_id, second);
  assert.equal(corrected.confidence, 'identifier');
  assert.equal(database.prepare('SELECT confirmations FROM provider_mapping WHERE id = ?').get(corrected.id).confirmations, 1);

  // An explicit user choice is allowed to replace an earlier confirmed mapping.
  repository.mapProvider({ entityType: 'recording', entityId: first, provider: 'zvuk',
    providerId: '85', basis: 'manual-choice', confidence: 'confirmed', evidenceKey: 'choice-old' });
  repository.mapProvider({ entityType: 'recording', entityId: second, provider: 'zvuk',
    providerId: '85', basis: 'manual-choice', confidence: 'confirmed', evidenceKey: 'choice-new', force: true });
  assert.equal(repository.findMapping('recording', 'zvuk', '85').entity_id, second);
  database.close();
});

test('clearing a Discovery vote also clears its migrated legacy rating', (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), 'orbita-graph-unvote-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const database = openGraphDatabase(path.join(profile, 'music-graph.sqlite'));
  const repository = new GraphRepository(database);
  assert.equal(repository.importVotes({ [recordingId]: 'like' }), 1);
  assert.equal(repository.counts().ratings, 1);
  repository.recordVote(recordingId, null);
  assert.equal(repository.counts().ratings, 0);
  assert.equal(database.prepare("SELECT count(*) AS n FROM rating WHERE source = 'discovery-legacy'").get().n, 0);
  database.close();
});

test('local favorites are recorded with the local provider', (t) => {
  const { profile, graph } = seededGraph(t);
  graph.recordFavorite({ id: 'local-abc', title: 'Local tone', artist: 'Local' }, true);
  graph.close();
  const database = openGraphDatabase(path.join(profile, 'music-graph.sqlite'));
  const event = database.prepare('SELECT provider, provider_track_id, type FROM user_event').get();
  assert.deepEqual({ ...event }, { provider: 'local', provider_track_id: 'local-abc', type: 'like' });
  database.close();
});

test('playback events are factual: start, completion, early skip and replay, never shutdown', () => {
  const events = [];
  const tracker = createPlaybackTracker((event) => events.push(event));
  const advance = (id, from, to, duration, paused = false) => {
    for (let time = from; time <= to + 0.001; time += 0.5) {
      tracker.update({ trackId: id, paused, time: Math.min(time, to), duration });
    }
  };
  tracker.update({ trackId: '83', title: 'Crownless', artist: 'Nightwish', paused: false, time: 0, duration: 200 });
  advance('83', 0.5, 100, 200);
  tracker.update({ trackId: '84', title: 'Second', artist: 'Nightwish', paused: false, time: 0, duration: 200 });
  advance('84', 0.5, 100, 200);
  advance('84', 101, 199.5, 200);
  tracker.update({ trackId: '84', paused: true, time: 199.8, duration: 200 });
  tracker.update({ trackId: '84', paused: false, time: 0, duration: 200 });
  tracker.stop();
  tracker.update({ trackId: '85', paused: false, time: 1, duration: 200 });

  assert.deepEqual(events.map((event) => event.type), ['play', 'skip', 'play', 'complete', 'replay', 'play']);
  assert.equal(events[1].trackId, '83');
  assert.ok(events[1].playedMs >= 99_000 && events[1].playedMs <= 101_000, String(events[1].playedMs));
  assert.equal(events[3].trackId, '84');
  assert.ok(events[3].playedMs > 190_000, String(events[3].playedMs));

  const seekEvents = [];
  const seekTracker = createPlaybackTracker((event) => seekEvents.push(event));
  seekTracker.update({ trackId: '90', paused: false, time: 0, duration: 300 });
  seekTracker.update({ trackId: '90', paused: false, time: 2, duration: 300 });
  seekTracker.update({ trackId: '90', paused: false, time: 180, duration: 300 });
  seekTracker.update({ trackId: '90', paused: false, time: 10, duration: 300 });
  seekTracker.update({ trackId: '90', paused: false, time: 120, duration: 300 });
  assert.deepEqual(seekEvents.map((event) => event.type), ['play']);
  assert.ok(seekTracker.current.listened < 0.001, 'small and large seeks are not listened time');

  const shortEvents = [];
  const shortTracker = createPlaybackTracker((event) => shortEvents.push(event));
  shortTracker.update({ trackId: '91', paused: false, time: 0, duration: 300 });
  shortTracker.update({ trackId: '92', paused: false, time: 0, duration: 300 });
  assert.deepEqual(shortEvents.map((event) => event.type), ['play', 'play']);

  const errorEvents = [];
  const errorTracker = createPlaybackTracker((event) => errorEvents.push(event));
  errorTracker.update({ trackId: '93', paused: false, time: 0, duration: 300 });
  for (let time = 0.5; time <= 5; time += 0.5) {
    errorTracker.update({ trackId: '93', paused: false, time, duration: 300 });
  }
  errorTracker.invalidate();
  errorTracker.update({ trackId: '94', paused: false, time: 0, duration: 300 });
  assert.deepEqual(errorEvents.map((event) => event.type), ['play', 'play']);
});

test('persistent provider cache serves public responses across instances and never stores tokens', async (t) => {
  const { graph } = seededGraph(t);
  let requests = 0;
  const first = createProviders(async () => {
    requests++;
    return Response.json({ artists: [{ id: nightwish, name: 'Nightwish' }] });
  }, { cache: graph.cache });
  const one = await first.music.artist('Nightwish');
  assert.equal(requests, 1);
  const second = createProviders(async () => {
    throw new Error('network must not be used for a cached response');
  }, { cache: graph.cache });
  const two = await second.music.artist('Nightwish');
  assert.deepEqual(two, one);
  assert.equal(requests, 1);
  assert.equal(graph.cache.stats().hits >= 1, true);

  // A token-bearing validation request uses cache:false and is never persisted.
  const secret = 'fixture-secret-token';
  let validations = 0;
  const tokenProvider = createProviders(async (_url, init) => {
    validations++;
    assert.equal(init.headers.Authorization, 'Token ' + secret);
    return Response.json({ valid: true });
  }, { cache: graph.cache });
  assert.equal(await tokenProvider.listen.validate(secret), true);
  assert.equal(validations, 1);

  graph.close();
  const raw = readFileSync(path.join(graph.path), 'utf8');
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes('Authorization'), false);
});

test('Discovery keeps Alpha.1 results identical while persisting and reusing the cache', async (t) => {
  const { graph } = seededGraph(t);
  const secret = 'fixture-token-not-exported';
  const votes = {};
  const storage = {
    readVotes: () => ({ ...votes }), vote(id, value) { if (value) votes[id] = value; else delete votes[id]; },
    readToken: () => null,
    credentialInfo: () => ({ configured: false, secure: true }),
  };
  let radioRequests = 0;
  let searchRequests = 0;
  const fetchImpl = async (href) => {
    const url = new URL(href);
    if (url.pathname.endsWith('/artist')) {
      return Response.json({ artists: [
        { id: epica, name: 'Epica', disambiguation: 'Dutch symphonic metal' },
      ] });
    }
    if (url.pathname.includes('/lb-radio/artist/')) {
      radioRequests++;
      return Response.json({ [nightwish]: [{ recording_mbid: recordingId, similar_artist_name: 'Nightwish' }] });
    }
    if (url.pathname === '/ws/2/recording/' + recordingId) return Response.json(crownless);
    throw new Error('unexpected ' + url.pathname);
  };
  const searchZvuk = async () => {
    searchRequests++;
    return [{ id: '83', title: 'Crownless', artist: 'Nightwish', album: 'Wishmaster',
      albumId: '5', artists: [{ id: '7', title: 'Nightwish' }], duration: 270, cover: 'https://cdn.test/cover.jpg' }];
  };
  const make = (providers) => new Discovery({
    providers, storage, connected: () => true, progress() {}, graph, cache: graph.cache,
    catalogScope: () => 'fixture-scope', searchZvuk,
  });

  const firstProviders = createProviders(fetchImpl, { cache: graph.cache });
  const first = make(firstProviders);
  const [{ options }] = await first.identify(['Epica']);
  assert.equal(options[0].id, epica);
  const reportA = await first.recommend([epica], 'medium', 10);
  assert.equal(reportA.candidates.length, 1);
  assert.equal(reportA.candidates[0].match.status, 'matched');
  assert.equal(reportA.notices.some((code) => code.startsWith('graph:')), false);
  const counts = graph.stats().counts;
  assert.ok(counts.recordings >= 1);
  assert.ok(counts.mappings >= 1);
  first.saveFeedback(recordingId, 'dislike');
  assert.equal(graph.stats().counts.ratings, 1);

  // Second run: new provider and service instances, same persistent cache.
  const secondProviders = createProviders(async () => { throw new Error('rate limit must not be hit'); }, { cache: graph.cache });
  const second = make(secondProviders);
  await second.identify(['Epica']);
  const reportB = await second.recommend([epica], 'medium', 10);
  const comparable = (report) => report.candidates.map(({ id, artistId, artistName, seedArtistIds,
    listenCount, recording: rec, match, feedback }) => ({ id, artistId, artistName, seedArtistIds,
    listenCount, recording: rec, match: { status: match.status, choice: match.choice?.track || null }, feedback }));
  assert.deepEqual(comparable(reportB), comparable(reportA));
  assert.equal(radioRequests, 1, 'ListenBrainz radio came from the persistent cache');
  assert.equal(searchRequests, 1, 'Zvuk search came from the persistent cache');
  const after = graph.stats().counts;
  for (const key of ['artists', 'recordings', 'releaseGroups', 'releases', 'relations', 'mappings']) {
    assert.equal(after[key], counts[key], key);
  }
  assert.equal(JSON.stringify(second.exportReport()).includes(secret), false);
  assert.equal(JSON.stringify(graph.stats()).includes(secret), false);
  graph.close();
});

test('playback and favorites update events and ratings only through confirmed mappings', (t) => {
  const { graph } = seededGraph(t);
  graph.recordReport(fixtureReport(), [{ id: epica, name: 'Epica' }]);
  assert.equal(graph.recordPlayback({ type: 'play', trackId: '83', title: 'Crownless',
    artist: 'Nightwish', dedupeKey: 'play:83:1' }), true);
  assert.equal(graph.recordPlayback({ type: 'play', trackId: '83', title: 'Crownless',
    artist: 'Nightwish', dedupeKey: 'play:83:1' }), false);
  assert.equal(graph.recordFavorite({ id: '83', title: 'Crownless', artist: 'Nightwish' }, true), true);
  assert.equal(graph.recordFavorite({ id: '999999', title: 'Unmapped' }, true), true);
  const counts = graph.stats().counts;
  assert.equal(counts.events, 3);
  assert.equal(counts.ratings, 2, 'discovery rating plus the player favorite on the mapped recording');
  graph.close();
});

test('external services can be unreachable without breaking Discovery or the graph', async () => {
  const providers = createProviders(async () => { throw new Error('offline'); });
  const discovery = new Discovery({
    providers,
    storage: { readVotes: () => ({}), vote() {}, readToken: () => null,
      credentialInfo: () => ({ configured: false, secure: true }) },
    connected: () => false, progress() {}, searchZvuk: async () => [],
  });
  const result = await discovery.identify(['Epica']);
  assert.equal(result[0].options.length, 0);
  assert.match(result[0].error, /musicbrainz:network/);
});

test('graph failures add a readable notice but never block recommendations', async () => {  const providers = createProviders(async (href) => {
    const url = new URL(href);
    if (url.pathname.endsWith('/artist')) return Response.json({ artists: [{ id: epica, name: 'Epica' }] });
    if (url.pathname.includes('/lb-radio/artist/')) {
      return Response.json({ [nightwish]: [{ recording_mbid: recordingId, similar_artist_name: 'Nightwish' }] });
    }
    return Response.json(crownless);
  });
  const make = (graph) => new Discovery({
    providers, storage: { readVotes: () => ({}), vote() {}, readToken: () => null,
      credentialInfo: () => ({ configured: false, secure: true }) },
    connected: () => false, progress() {}, graph, searchZvuk: async () => [],
  });
  const unavailable = make({ available: false, error: 'graph-unavailable' });
  const [{ options }] = await unavailable.identify(['Epica']);
  const reportA = await unavailable.recommend([options[0].id], 'medium', 10);
  assert.equal(reportA.candidates.length, 1);
  assert.ok(reportA.notices.includes('graph:unavailable'));

  const failing = make({ available: true, recordReport: () => ({ stored: false, error: 'graph-storage' }) });
  await failing.identify(['Epica']);
  const reportB = await failing.recommend([options[0].id], 'medium', 10);
  assert.equal(reportB.candidates.length, 1);
  assert.ok(reportB.notices.includes('graph:storage'));
});

test('10 000 recordings and related entities stay indexed and responsive', (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), 'orbita-graph-scale-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const database = openGraphDatabase(path.join(profile, 'music-graph.sqlite'));
  assert.equal(database.status.available, true);
  const repository = new GraphRepository(database);
  const total = 10_000;
  const started = Date.now();
  database.transaction(() => {
    const insertArtist = database.prepare(`INSERT INTO artist(mbid, name, name_key, created_at, updated_at)
      VALUES(NULL, ?, ?, ?, ?)`);
    const insertRecording = database.prepare(`INSERT INTO recording(mbid, title, title_key, created_at, updated_at)
      VALUES(NULL, ?, ?, ?, ?)`);
    const insertRelation = database.prepare(`INSERT INTO relation(subject_type, subject_id, predicate,
      object_type, object_id, source, created_at, last_confirmed_at, confirmations)
      VALUES('artist', ?, 'performed', 'recording', ?, 'fixture', ?, ?, 1)`);
    const insertEvent = database.prepare(`INSERT INTO user_event(type, entity_type, entity_id, recording_id,
      provider, provider_track_id, created_at) VALUES('play', 'recording', ?, ?, 'zvuk', ?, ?)`);
    const at = new Date().toISOString();
    for (let i = 1; i <= total; i++) {
      insertArtist.run('Artist ' + i, 'artist ' + i, at, at);
      insertRecording.run('Recording ' + i, 'recording ' + i, at, at);
      insertRelation.run(i, i, at, at);
      insertEvent.run(i, i, String(100000 + i), at);
    }
  });
  const writeMs = Date.now() - started;
  const statsStarted = Date.now();
  const counts = repository.counts();
  const statsMs = Date.now() - statsStarted;
  assert.equal(counts.recordings, total);
  assert.equal(counts.artists, total);
  assert.equal(counts.relations, total);
  assert.equal(counts.events, total);
  assert.ok(statsMs < 500, 'aggregate stats took ' + statsMs + 'ms');
  assert.ok(writeMs < 20_000, '10k batch took ' + writeMs + 'ms');

  const lookupStarted = Date.now();
  const row = database.prepare(`SELECT recording_id FROM user_event WHERE provider = 'zvuk'
    AND provider_track_id = ?`).get('105000');
  const lookupMs = Date.now() - lookupStarted;
  assert.equal(row.recording_id, 5000);
  assert.ok(lookupMs < 50);
  database.close();
});
