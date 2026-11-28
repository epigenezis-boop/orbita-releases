'use strict';

const { DiscoveryError } = require('./providers.cjs');

const mbidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const mbid = (value) => typeof value === 'string' && mbidPattern.test(value) ? value.toLowerCase() : null;
const isrc = (value) => {
  const code = typeof value === 'string' ? value.toUpperCase().replace(/-/g, '') : '';
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(code) ? code : null;
};
const text = (value) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 400) : '';
const array = (value) => Array.isArray(value) ? value : [];
const normalized = (value) => text(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function artist(value) {
  const id = mbid(value?.id);
  const name = text(value?.name);
  if (!id || !name) return null;
  return {
    id, name, disambiguation: text(value.disambiguation), country: text(value.country),
    area: text(value.area?.name), type: text(value.type), begin: text(value['life-span']?.begin),
  };
}

function resolveArtists(result, query) {
  if (result === null) return [];
  if (!Array.isArray(result?.artists)) throw new DiscoveryError('invalid-response', 'musicbrainz');
  const unique = new Map();
  for (const entry of result.artists) {
    const a = artist(entry);
    if (a) unique.set(a.id, a);
  }
  const all = [...unique.values()];
  const exact = all.filter((a) => normalized(a.name) === normalized(query));
  return exact.length ? exact : all.slice(0, 8);
}

function radioCandidates(responses, seeds, count) {
  const bySeed = new Set(seeds);
  const unique = new Map();
  const byArtist = new Map();
  const artistOrderBySeed = new Map();
  for (const { seed, data } of responses) {
    if (data === null) continue;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new DiscoveryError('invalid-response', 'listenbrainz');
    }
    const artistOrder = [];
    artistOrderBySeed.set(seed, artistOrder);
    for (const [rawArtist, recordings] of Object.entries(data)) {
      const artistId = mbid(rawArtist);
      if (!artistId || bySeed.has(artistId) || !Array.isArray(recordings)) continue;
      artistOrder.push(artistId);
      for (const item of recordings) {
        const id = mbid(item?.recording_mbid);
        if (!id) continue;
        if (unique.has(id)) {
          const provenance = unique.get(id).seedArtistIds;
          if (!provenance.includes(seed)) provenance.push(seed);
          continue;
        }
        const candidate = {
          id, artistId, artistName: text(item.similar_artist_name), seedArtistIds: [seed],
          listenCount: Number.isSafeInteger(item.total_listen_count) && item.total_listen_count >= 0
            ? item.total_listen_count : null,
        };
        unique.set(id, candidate);
        if (!byArtist.has(artistId)) byArtist.set(artistId, []);
        byArtist.get(artistId).push(candidate);
      }
    }
  }

  const artistOrders = [...artistOrderBySeed.values()];
  const artistOrder = new Set();
  for (let offset = 0; artistOrders.some((order) => order.length > offset); offset++) {
    for (const order of artistOrders) if (order[offset]) artistOrder.add(order[offset]);
  }
  const lists = [...artistOrder].map((id) => byArtist.get(id)).filter(Boolean);
  const result = [];
  for (let offset = 0; result.length < count && lists.some((list) => list.length > offset); offset++) {
    for (const list of lists) {
      if (list[offset]) result.push(list[offset]);
      if (result.length === count) break;
    }
  }
  return result;
}

function recording(raw, candidate) {
  if (raw === null) return null;
  const id = mbid(raw?.id);
  const title = text(raw?.title);
  if (!id || !title) throw new DiscoveryError('invalid-response', 'musicbrainz');

  const artists = array(raw['artist-credit']).flatMap((entry) => {
    const a = artist(entry?.artist);
    return a ? [{ ...a, credit: text(entry.name) || a.name, joinPhrase: String(entry.joinphrase ?? '').slice(0, 20) }] : [];
  });
  const releases = [];
  const releaseGroups = new Map();
  for (const entry of array(raw.releases)) {
    const releaseId = mbid(entry?.id);
    const releaseTitle = text(entry?.title);
    if (!releaseId || !releaseTitle) continue;
    const group = entry['release-group'];
    const groupId = mbid(group?.id);
    if (groupId && !releaseGroups.has(groupId)) {
      releaseGroups.set(groupId, {
        id: groupId, title: text(group.title), primaryType: text(group['primary-type']),
        secondaryTypes: array(group['secondary-types']).map(text).filter(Boolean),
        firstReleaseDate: text(group['first-release-date']),
      });
    }
    releases.push({
      id: releaseId, title: releaseTitle, groupId, date: text(entry.date), status: text(entry.status),
      country: text(entry.country),
    });
  }
  return {
    id, title, kind: 'recording', disambiguation: text(raw.disambiguation),
    artistCredit: artists.map((a) => a.credit + a.joinPhrase).join('') || candidate.artistName,
    artists, durationMs: Number.isFinite(raw.length) && raw.length > 0 ? raw.length : null,
    isrcs: [...new Set(array(raw.isrcs).map(isrc).filter(Boolean))],
    releases, releaseGroups: [...releaseGroups.values()],
  };
}

const versions = [
  ['live', /\blive\b|концерт|жив(ая|ой|ое)\s+запись/i],
  ['remaster', /\bremaster(?:ed)?\b|ремастер/i],
  ['remix', /\b(?:re)?mix(?:ed)?\b|ремикс/i],
  ['acoustic', /\bacoustic\b|акуст/i],
  ['instrumental', /\binstrumental\b|инструментал/i],
  ['demo', /\bdemo\b|демо/i],
  ['karaoke', /\bkaraoke\b|караоке/i],
  ['cover', /\bcover\b|кавер/i],
  ['edit', /\b(?:radio edit|edit|extended|alternate|version)\b|радиоверсия/i],
  ['re-recorded', /\bre[\s-]?record(?:ed|ing)\b|перезапис/i],
  ['sped-up', /\b(?:sped up|slowed|nightcore)\b/i],
];

function versionTags(...values) {
  return versions.filter(([, pattern]) => values.some((value) => pattern.test(value || ''))).map(([name]) => name);
}

function baseTitle(value) {
  return normalized(text(value).replace(/\s*(?:\([^()]*\)|\[[^\[\]]*\])\s*$/u, (suffix) =>
    versionTags(suffix).length ? '' : suffix).replace(/\s+[-–—]\s+([^–—]+)$/u, (suffix) =>
    versionTags(suffix).length ? '' : suffix));
}

function matchRecording(recording, result) {
  const wantedTitle = normalized(recording.title);
  const wantedArtists = recording.artists.length
    ? new Set(recording.artists.map((entry) => normalized(entry.credit)))
    : new Set([normalized(recording.artistCredit)].filter(Boolean));
  const albums = new Set([...recording.releases, ...recording.releaseGroups].map((entry) => normalized(entry.title)).filter(Boolean));
  const recordingVersions = versionTags(recording.title, recording.disambiguation);
  const matches = new Map();

  for (const track of result) {
    if (!track || typeof track.id !== 'string' || !/^\d{1,24}$/.test(track.id)) continue;
    const recordingId = mbid(track.recordingMbid);
    const trackIsrc = isrc(track.isrc);
    const sameRecording = recordingId === recording.id;
    const sameIsrc = trackIsrc && recording.isrcs.includes(trackIsrc);
    if ((recordingId && !sameRecording) || (trackIsrc && recording.isrcs.length && !sameIsrc && !sameRecording)) continue;
    const trackVersions = versionTags(track.title, track.album);
    // Explicit edition markers are never silently exchanged, even for a shared recording ID.
    if (recordingVersions.join() !== trackVersions.join()) continue;
    const title = normalized(track.title);
    const artist = normalized(track.artist);
    const similarArtists = array(track.artists).map((entry) => normalized(entry?.title)).filter(Boolean);
    const sameArtist = wantedArtists.size > 0 && (
      wantedArtists.has(artist) && wantedArtists.size === 1 ||
      artist === normalized(recording.artistCredit) ||
      similarArtists.length > 0 && similarArtists.length === wantedArtists.size && similarArtists.every((name) => wantedArtists.has(name))
    );
    const delta = recording.durationMs && track.duration > 0 ? Math.abs(recording.durationMs / 1000 - track.duration) : null;
    const sameAlbum = albums.has(normalized(track.album));
    const reasons = [];
    let score = 0;
    let confidence = 'review';
    if (sameRecording || sameIsrc) {
      if (delta !== null && delta > 6) continue;
      score = sameRecording ? 200 : 180;
      reasons.push(sameRecording ? 'recording-mbid' : 'isrc');
      confidence = 'identifier';
    } else {
      if (!sameArtist || (title !== wantedTitle && baseTitle(track.title) !== baseTitle(recording.title))) continue;
      if (delta !== null && delta > 7) continue;
      reasons.push('artist', 'title');
      score = 30;
      if (sameAlbum) { score += 25; reasons.push('album'); }
      if (delta !== null) { score += delta <= 3 ? 20 : 8; reasons.push('duration'); }
      if (title === wantedTitle && sameAlbum && delta !== null && delta <= 3) confidence = 'metadata';
    }
    matches.set(track.id, { track, reasons, confidence, score });
  }

  const ordered = [...matches.values()].sort((a, b) => b.score - a.score);
  if (!ordered.length) return { status: 'not-found', options: [] };
  const [best, next] = ordered;
  if (best.confidence !== 'review' && (!next || best.score - next.score >= 15)) {
    return { status: 'matched', choice: best, options: [] };
  }
  return { status: 'review', options: ordered.slice(0, 5) };
}

module.exports = { mbid, text, artist, resolveArtists, radioCandidates, recording, matchRecording };
