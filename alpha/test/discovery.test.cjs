'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createProviders, DiscoveryError } = require('../src/discovery/providers.cjs');
const { createStorage } = require('../src/discovery/storage.cjs');
const { Discovery } = require('../src/discovery/service.cjs');
const { radioCandidates, recording, matchRecording } = require('../src/discovery/model.cjs');

const nightwish = '00a9f935-ba93-4fc8-a33a-993abe9c936b';
const epica = '21985b14-1b0d-44fe-b357-310b29bba510';
const epicaNamesake = '799a91e7-33db-48b4-aa71-9479aa81bf32';
const within = 'eace2373-31c8-4aba-9a5c-7bce22dd140a';
const recordingId = '55fda018-552c-4616-aced-2b4f7065e4a7';
const secondId = '0b6ad0ba-2ef2-4d1f-9dee-0ca2f1d5c7cc';
const releaseId = '76d7a3b7-cf35-409f-9eb5-36d42fcae28b';
const groupId = 'c32724fe-9b96-3e3a-b687-fc76b1bcbe25';
const crownless = {
  id: recordingId, title: 'Crownless', length: 269000, isrcs: ['FISFS0000087'],
  'artist-credit': [{ name: 'Nightwish', artist: { id: nightwish, name: 'Nightwish' } }],
  releases: [{ id: releaseId, title: 'Wishmaster', date: '2000',
    'release-group': { id: groupId, title: 'Wishmaster', 'primary-type': 'Album' } }],
};

function catalogTrack(id, changes = {}) {
  return { id, title: 'Crownless', artist: 'Nightwish', album: 'Wishmaster', albumId: '5',
    artists: [{ id: '7', title: 'Nightwish' }], duration: 270, ...changes };
}

test('Radio merges provenance across seeds, discards invalid MBIDs and retains release identity', () => {
  const row = (recording_mbid) => ({ recording_mbid, similar_artist_name: 'Nightwish' });
  const candidates = radioCandidates([
    { seed: epica, data: { [nightwish]: [row(recordingId), row('missing')], [epica]: [row(secondId)] } },
    { seed: within, data: { [nightwish]: [row(recordingId.toUpperCase())] } },
  ], [epica, within], 10);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].seedArtistIds, [epica, within]);
  const metadata = recording(crownless, candidates[0]);
  assert.equal(metadata.releases[0].id, releaseId);
  assert.equal(metadata.releases[0].groupId, groupId);
  assert.equal(metadata.releaseGroups[0].primaryType, 'Album');
});

test('Zvuk matching distinguishes editions and requires review for equally plausible releases', () => {
  const metadata = recording(crownless, {});
  const live = catalogTrack('1', { title: 'Crownless (live)', album: 'From Wishes to Eternity' });
  const remaster = catalogTrack('2', { title: 'Crownless (2015 remaster)' });
  const cover = catalogTrack('3', { artist: 'Other artist', artists: [] });
  const correct = catalogTrack('4');
  const other = catalogTrack('5', { album: 'Another compilation', albumId: '8' });
  const verified = matchRecording(metadata, [live, remaster, cover, correct, other]);
  assert.equal(verified.choice.track.id, '4');
  assert.equal(verified.choice.confidence, 'metadata');
  assert.equal(matchRecording(metadata, [live, remaster, cover]).status, 'not-found');
  assert.equal(matchRecording(metadata, [correct, catalogTrack('6')]).status, 'review');
  const strong = matchRecording(metadata, [correct, { ...other, isrc: metadata.isrcs[0] }]);
  assert.equal(strong.choice.track.id, '5');
  assert.equal(strong.choice.confidence, 'identifier');
});

test('artist ambiguity, read-only requests, local feedback and private export work through the service', async (t) => {
  const profile = mkdtempSync(path.join(tmpdir(), 'orbita-discovery-test-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const secret = 'fixture-token-for-test';
  // DPAPI is checked by the Windows Electron smoke. This adapter verifies the storage boundary.
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value).reverse(),
    decryptString: (value) => Buffer.from(value).reverse().toString(),
  };
  const storage = createStorage(profile, safeStorage);
  const providers = createProviders(async (href, init) => {
    const url = new URL(href);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(url.href.includes(secret), false);
    if (url.pathname.endsWith('/validate-token')) {
      assert.equal(init.headers.Authorization, 'Token ' + secret);
      return Response.json({ valid: true, user_name: 'private-fixture-account' });
    }
    assert.equal(init.headers.Authorization, undefined);
    if (url.pathname.endsWith('/artist')) return Response.json({ artists: [
      { id: epica, name: 'Epica', disambiguation: 'Dutch symphonic metal' },
      { id: epicaNamesake, name: 'Epica', disambiguation: 'Another artist' },
    ] });
    if (url.pathname.includes('/lb-radio/artist/')) return Response.json({
      [nightwish]: [{ recording_mbid: recordingId, similar_artist_name: 'Nightwish' }],
    });
    assert.equal(url.pathname, '/ws/2/recording/' + recordingId);
    assert.match(url.searchParams.get('inc'), /release-groups/);
    return Response.json(crownless);
  });
  const discovery = new Discovery({
    providers, storage, connected: () => true, progress() {},
    searchZvuk: async () => [catalogTrack('83', { cover: 'https://example.test/private-art-url' })],
  });
  const status = await discovery.credential('save', secret);
  assert.deepEqual(status, { configured: true, secure: true, status: 'connected' });
  assert.equal(readFileSync(path.join(profile, 'discovery-credential.bin')).includes(secret), false);
  const [{ options }] = await discovery.identify(['Epica']);
  assert.equal(options.length, 2);
  const report = await discovery.recommend([options[0].id], 'medium', 10);
  assert.equal(report.candidates[0].match.status, 'matched');
  assert.equal(discovery.choose(recordingId, '83').title, 'Crownless');
  discovery.saveFeedback(recordingId, 'like');
  assert.equal(createStorage(profile, safeStorage).readVotes()[recordingId], 'like');
  const serialized = JSON.stringify(discovery.exportReport());
  for (const forbidden of [secret, 'private-fixture-account', 'private-art-url']) assert.ok(!serialized.includes(forbidden));
  discovery.accountChanged();
  assert.throws(() => discovery.choose(recordingId, '83'), /zvuk:denied/);
  await discovery.credential('remove');
  assert.equal(storage.readToken(), null);
});

test('read-only provider handles no-content, denial, rate limits and cancellation without retries', async () => {
  let requests = 0;
  const provider = createProviders(async (url) => {
    requests++;
    if (url.includes('/validate-token')) return new Response(null, { status: 401 });
    if (url.includes(nightwish)) return new Response(null, { status: 204 });
    return new Response(null, { status: 429, headers: { 'Retry-After': '60' } });
  }).listen;
  assert.equal(await provider.radio(nightwish, 'medium'), null);
  assert.equal(await provider.radio(nightwish, 'medium'), null);
  await assert.rejects(provider.validate('fixture-token'), { code: 'denied' });
  await assert.rejects(provider.radio(epica, 'medium'), { code: 'rate-limited' });
  await assert.rejects(provider.radio(within, 'medium'), { code: 'rate-limited' });
  assert.equal(requests, 3);
  const cancelled = new AbortController();
  const transient = createProviders((_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    queueMicrotask(() => cancelled.abort(new DiscoveryError('cancelled')));
  })).music;
  await assert.rejects(transient.recording(recordingId, cancelled.signal), { code: 'cancelled' });
});
