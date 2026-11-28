'use strict';

const { mbid, text } = require('../discovery/model.cjs');

const CONFIDENCE_RANK = { '': 0, reported: 1, tagged: 1, metadata: 2, identifier: 3, confirmed: 4 };
const CONFIDENCE = new Set(Object.keys(CONFIDENCE_RANK));
const MAX_DETAIL = 4000;

function normalizeKey(value) {
  return text(value).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/[’']/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 300);
}

function confidenceLabel(value) {
  return CONFIDENCE.has(value) ? value : '';
}

function detail(value) {
  if (value === undefined || value === null) return '{}';
  try {
    const encoded = JSON.stringify(value);
    return encoded.length <= MAX_DETAIL ? encoded : JSON.stringify({ truncated: true });
  } catch {
    return '{}';
  }
}

function integer(value, min = 0) {
  return Number.isSafeInteger(value) && value >= min ? value : null;
}

class GraphRepository {
  constructor(database) {
    this.database = database;
    this.statements = new Map();
    this.lastSeenAt = null;
  }

  sql(query) {
    let statement = this.statements.get(query);
    if (!statement) {
      statement = this.database.prepare(query);
      this.statements.set(query, statement);
    }
    return statement;
  }

  now() {
    const value = new Date().toISOString();
    this.lastSeenAt = value;
    return value;
  }

  touch(meta = {}) {
    const at = this.now();
    this.sql(`INSERT INTO graph_meta(key, value, updated_at) VALUES('last_updated', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(at, at);
    if (Object.keys(meta).length) {
      const key = Object.keys(meta)[0];
      this.sql(`INSERT INTO graph_meta(key, value, updated_at) VALUES(?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .run(key, String(meta[key]).slice(0, 400), at);
    }
  }

  upsertArtist(value) {
    const id = mbid(value?.mbid || value?.id);
    const name = text(value?.name);
    if (!name) return null;
    const nameKey = normalizeKey(name);
    const disambiguation = text(value?.disambiguation);
    const fields = {
      country: text(value?.country), area: text(value?.area), type: text(value?.type),
      begin: text(value?.begin || value?.['life-span']?.begin),
    };
    const at = this.now();
    let row = id ? this.sql('SELECT id FROM artist WHERE mbid = ?').get(id) : null;
    if (!row) {
      row = this.sql('SELECT id FROM artist WHERE mbid IS NULL AND name_key = ? AND disambiguation = ?')
        .get(nameKey, disambiguation);
      if (row && id) {
        // Attach the MusicBrainz identity to the local row instead of duplicating it.
        this.sql('UPDATE artist SET mbid = ?, updated_at = ? WHERE id = ?').run(id, at, row.id);
      }
    }
    if (row) {
      this.sql(`UPDATE artist SET name = ?, name_key = ?, disambiguation = ?,
        country = COALESCE(NULLIF(?, ''), country), area = COALESCE(NULLIF(?, ''), area),
        type = COALESCE(NULLIF(?, ''), type), begin_date = COALESCE(NULLIF(?, ''), begin_date),
        updated_at = ? WHERE id = ?`)
        .run(name, nameKey, disambiguation, fields.country, fields.area, fields.type, fields.begin,
          at, row.id);
      return row.id;
    }
    const result = this.sql(`INSERT INTO artist(mbid, name, name_key, disambiguation, country, area, type,
      begin_date, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, name, nameKey, disambiguation, fields.country, fields.area, fields.type, fields.begin,
        at, at);
    return Number(result.lastInsertRowid);
  }

  upsertRecording(value) {
    const id = mbid(value?.mbid || value?.id);
    const title = text(value?.title) || id;
    if (!title) return null;
    const titleKey = normalizeKey(title);
    const disambiguation = text(value?.disambiguation);
    const duration = integer(value?.durationMs ?? value?.duration_ms, 1);
    const at = this.now();
    let row = id ? this.sql('SELECT id FROM recording WHERE mbid = ?').get(id) : null;
    if (!row) {
      row = this.sql('SELECT id FROM recording WHERE mbid IS NULL AND title_key = ? AND disambiguation = ?')
        .get(titleKey, disambiguation);
      if (row && id) this.sql('UPDATE recording SET mbid = ?, updated_at = ? WHERE id = ?').run(id, at, row.id);
    }
    let rowId;
    if (row) {
      rowId = row.id;
      this.sql(`UPDATE recording SET title = ?, title_key = ?, disambiguation = ?,
        duration_ms = COALESCE(?, duration_ms), updated_at = ? WHERE id = ?`)
        .run(title, titleKey, disambiguation, duration, at, rowId);
    } else {
      const result = this.sql(`INSERT INTO recording(mbid, title, title_key, disambiguation, duration_ms,
        created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?)`)
        .run(id, title, titleKey, disambiguation, duration, at, at);
      rowId = Number(result.lastInsertRowid);
    }
    for (const code of Array.isArray(value?.isrcs) ? value.isrcs : []) {
      if (typeof code !== 'string') continue;
      const normalized = code.toUpperCase().replace(/-/g, '');
      if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normalized)) continue;
      this.sql('INSERT OR IGNORE INTO recording_isrc(isrc, recording_id) VALUES(?, ?)').run(normalized, rowId);
    }
    return rowId;
  }

  ensureRecording(recordingMbid) {
    const id = mbid(recordingMbid);
    if (!id) return null;
    const row = this.sql('SELECT id FROM recording WHERE mbid = ?').get(id);
    if (row) return row.id;
    return this.upsertRecording({ mbid: id, title: id });
  }

  upsertReleaseGroup(value) {
    const id = mbid(value?.id || value?.groupId || value?.mbid);
    const title = text(value?.title);
    if (!title) return null;
    const titleKey = normalizeKey(title);
    const primaryType = text(value?.primaryType || value?.primary_type);
    const secondary = Array.isArray(value?.secondaryTypes)
      ? JSON.stringify(value.secondaryTypes.map(text).filter(Boolean)) : null;
    const firstDate = text(value?.firstReleaseDate || value?.first_release_date);
    const at = this.now();
    let row = id ? this.sql('SELECT id FROM release_group WHERE mbid = ?').get(id) : null;
    if (!row) {
      row = this.sql('SELECT id FROM release_group WHERE mbid IS NULL AND title_key = ? AND primary_type = ?')
        .get(titleKey, primaryType);
      if (row && id) this.sql('UPDATE release_group SET mbid = ?, updated_at = ? WHERE id = ?').run(id, at, row.id);
    }
    if (row) {
      this.sql(`UPDATE release_group SET title = ?, title_key = ?, primary_type = ?,
        secondary_types = COALESCE(?, secondary_types),
        first_release_date = COALESCE(NULLIF(?, ''), first_release_date), updated_at = ?
        WHERE id = ?`).run(title, titleKey, primaryType, secondary, firstDate, at, row.id);
      return row.id;
    }
    const result = this.sql(`INSERT INTO release_group(mbid, title, title_key, primary_type, secondary_types,
      first_release_date, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, title, titleKey, primaryType, secondary ?? '[]', firstDate, at, at);
    return Number(result.lastInsertRowid);
  }

  upsertRelease(value, groupId) {
    const id = mbid(value?.id || value?.mbid);
    const title = text(value?.title);
    if (!title) return null;
    const titleKey = normalizeKey(title);
    const date = text(value?.date);
    const country = text(value?.country);
    const status = text(value?.status);
    const at = this.now();
    let row = id ? this.sql('SELECT id FROM release WHERE mbid = ?').get(id) : null;
    if (!row) {
      row = this.sql(`SELECT id FROM release WHERE mbid IS NULL AND title_key = ?
        AND date = ? AND release_group_id IS ?`).get(titleKey, date, groupId ?? null);
      if (row && id) this.sql('UPDATE release SET mbid = ?, updated_at = ? WHERE id = ?').run(id, at, row.id);
    }
    if (row) {
      this.sql(`UPDATE release SET title = ?, title_key = ?, release_group_id = COALESCE(?, release_group_id),
        date = COALESCE(NULLIF(?, ''), date), country = COALESCE(NULLIF(?, ''), country),
        status = COALESCE(NULLIF(?, ''), status), updated_at = ? WHERE id = ?`)
        .run(title, titleKey, groupId ?? null, date, country, status, at, row.id);
      return row.id;
    }
    const result = this.sql(`INSERT INTO release(mbid, release_group_id, title, title_key, date, country,
      status, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, groupId ?? null, title, titleKey, date, country, status, at, at);
    return Number(result.lastInsertRowid);
  }

  upsertReleaseTrack(value) {
    const releaseId = integer(value?.releaseId, 1);
    const recordingId = integer(value?.recordingId, 1);
    const medium = integer(value?.mediumPosition, 1);
    const position = integer(value?.trackPosition, 1);
    if (!releaseId || !recordingId || !medium || !position) return null;
    const at = this.now();
    const result = this.sql(`INSERT INTO release_track(release_id, recording_id, medium_position,
      track_position, title, duration_ms, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(release_id, medium_position, track_position) DO UPDATE SET
        recording_id = excluded.recording_id,
        title = COALESCE(NULLIF(excluded.title, ''), release_track.title),
        duration_ms = COALESCE(excluded.duration_ms, release_track.duration_ms),
        updated_at = excluded.updated_at
      RETURNING id`).get(releaseId, recordingId, medium, position, text(value?.title),
      integer(value?.durationMs, 1), at, at);
    return result?.id ?? null;
  }

  upsertTag(name, kind = '') {
    const label = text(name);
    if (!label) return null;
    const key = normalizeKey(label);
    if (!key) return null;
    const row = this.sql('SELECT id, kind FROM tag WHERE name_key = ?').get(key);
    if (row) {
      if (kind && !row.kind) this.sql('UPDATE tag SET kind = ? WHERE id = ?').run(text(kind), row.id);
      return row.id;
    }
    const result = this.sql('INSERT INTO tag(name, name_key, kind) VALUES(?, ?, ?)')
      .run(label, key, text(kind));
    return Number(result.lastInsertRowid);
  }

  link({ subjectType, subjectId, predicate, objectType, objectId, source, basis = '', confidence = '', detail: extra, evidenceKey }) {
    if (!subjectType || !subjectId || !predicate || !objectType || !objectId || !source) return null;
    const at = this.now();
    const id = this.sql(`INSERT INTO relation(subject_type, subject_id, predicate, object_type, object_id,
      source, basis, confidence, detail, created_at, last_confirmed_at, confirmations)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(subject_type, subject_id, predicate, object_type, object_id, source) DO UPDATE SET
        last_confirmed_at = excluded.last_confirmed_at,
        basis = CASE WHEN excluded.basis <> '' THEN excluded.basis ELSE relation.basis END,
        confidence = CASE WHEN excluded.confidence <> '' THEN excluded.confidence ELSE relation.confidence END,
        detail = CASE WHEN excluded.detail <> '{}' THEN excluded.detail ELSE relation.detail END
      RETURNING id`).get(subjectType, subjectId, predicate, objectType, objectId, source,
      text(basis), confidenceLabel(confidence), detail(extra), at, at).id;
    if (id && evidenceKey) {
      const changed = this.sql(`INSERT OR IGNORE INTO relation_evidence(relation_id, evidence_key, observed_at)
        VALUES(?, ?, ?)`).run(id, text(evidenceKey).slice(0, 300), at).changes;
      if (changed) {
        this.sql(`UPDATE relation SET confirmations =
          (SELECT COUNT(*) FROM relation_evidence WHERE relation_id = relation.id) WHERE id = ?`).run(id);
      }
    }
    return id;
  }

  tagEntity({ entityType, entityId, name, source, basis = '', confidence = '', kind = '' }) {
    const tagId = this.upsertTag(name, kind);
    if (!tagId || !entityType || !entityId || !source) return false;
    const at = this.now();
    this.sql(`INSERT INTO entity_tag(entity_type, entity_id, tag_id, source, basis, confidence,
      created_at, last_confirmed_at, confirmations) VALUES(?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(entity_type, entity_id, tag_id, source) DO UPDATE SET
        last_confirmed_at = excluded.last_confirmed_at,
        basis = CASE WHEN excluded.basis <> '' THEN excluded.basis ELSE entity_tag.basis END,
        confidence = CASE WHEN excluded.confidence <> '' THEN excluded.confidence ELSE entity_tag.confidence END`)
      .run(entityType, entityId, tagId, source, text(basis), confidenceLabel(confidence), at, at);
    return true;
  }

  mapProvider({ entityType, entityId, provider, providerId, parentId = '', basis = '', confidence = '', evidenceKey, force = false }) {
    if (!entityType || !entityId || !provider || !providerId) return null;
    const at = this.now();
    const incoming = confidenceLabel(confidence);
    const incomingRank = CONFIDENCE_RANK[incoming];
    const identity = this.sql(`SELECT id, entity_id, confidence FROM provider_mapping
      WHERE entity_type = ? AND provider = ? AND provider_id = ?`)
      .get(entityType, provider, providerId);
    let id;
    let storedEntityId = entityId;
    let addEvidence = true;
    if (identity) {
      id = identity.id;
      const sameTarget = identity.entity_id === entityId;
      if (!sameTarget && !force && incomingRank <= CONFIDENCE_RANK[identity.confidence]) {
        // Never let an automatic report move a user-confirmed or stronger mapping.
        this.sql('UPDATE provider_mapping SET last_confirmed_at = ? WHERE id = ?').run(at, id);
        storedEntityId = identity.entity_id;
        addEvidence = false;
      } else if (!sameTarget) {
        // A strictly stronger identity (for example identifier over metadata) may correct it.
        this.sql(`UPDATE provider_mapping SET entity_id = ?, last_confirmed_at = ?,
          basis = ?, confidence = ?, provider_parent_id = COALESCE(NULLIF(?, ''), provider_parent_id),
          confirmations = 1 WHERE id = ?`)
          .run(entityId, at, text(basis), incoming, text(parentId), id);
        this.sql('DELETE FROM mapping_evidence WHERE mapping_id = ?').run(id);
      } else {
        const strongest = incomingRank >= CONFIDENCE_RANK[identity.confidence] ? incoming : identity.confidence;
        this.sql(`UPDATE provider_mapping SET last_confirmed_at = ?,
          basis = CASE WHEN ? <> '' THEN ? ELSE basis END,
          confidence = ?, provider_parent_id = COALESCE(NULLIF(?, ''), provider_parent_id) WHERE id = ?`)
          .run(at, text(basis), text(basis), strongest, text(parentId), id);
      }
    } else {
      id = Number(this.sql(`INSERT INTO provider_mapping(entity_type, entity_id, provider, provider_id,
        provider_parent_id, basis, confidence, created_at, last_confirmed_at, confirmations)
        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .run(entityType, entityId, provider, providerId, text(parentId), text(basis),
          incoming, at, at).lastInsertRowid);
    }
    if (id && evidenceKey && addEvidence) {
      const changed = this.sql(`INSERT OR IGNORE INTO mapping_evidence(mapping_id, evidence_key, observed_at)
        VALUES(?, ?, ?)`).run(id, text(evidenceKey).slice(0, 300), at).changes;
      if (changed) {
        this.sql(`UPDATE provider_mapping SET confirmations =
          (SELECT COUNT(*) FROM mapping_evidence WHERE mapping_id = provider_mapping.id) WHERE id = ?`).run(id);
      }
    }
    if (id && entityType === 'recording') {
      // Link or re-point events when a catalog mapping is created or corrected.
      this.sql(`UPDATE user_event SET recording_id = ?, entity_id = ?
        WHERE provider = ? AND provider_track_id = ?`)
        .run(storedEntityId, storedEntityId, provider, providerId);
    }
    return id;
  }

  findMapping(entityType, provider, providerId) {
    if (!entityType || !provider || !providerId) return null;
    return this.sql(`SELECT id, entity_id, provider_parent_id, confidence FROM provider_mapping
      WHERE entity_type = ? AND provider = ? AND provider_id = ?`)
      .get(entityType, provider, String(providerId)) || null;
  }

  rate({ entityType, entityId, source, value }) {
    if (!entityType || !entityId || !source) return false;
    const at = this.now();
    if (value === 0 || value === null || value === undefined) {
      this.sql('DELETE FROM rating WHERE entity_type = ? AND entity_id = ? AND source = ?')
        .run(entityType, entityId, source);
      return true;
    }
    if (value !== 1 && value !== -1) return false;
    this.sql(`INSERT INTO rating(entity_type, entity_id, source, value, created_at, updated_at)
      VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(entity_type, entity_id, source) DO UPDATE SET
        value = excluded.value, updated_at = excluded.updated_at`)
      .run(entityType, entityId, source, value, at, at);
    return true;
  }

  event(value) {
    if (!value?.type) return null;
    const at = new Date().toISOString();
    const result = this.sql(`INSERT OR IGNORE INTO user_event(type, entity_type, entity_id, recording_id,
      provider, provider_track_id, position_ms, duration_ms, played_ms, created_at, detail, dedupe_key)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(text(value.type).slice(0, 40), text(value.entityType), integer(value.entityId, 1),
        integer(value.recordingId, 1), text(value.provider), text(value.providerTrackId).slice(0, 200),
        integer(value.positionMs), integer(value.durationMs, 1), integer(value.playedMs),
        at, detail(value.detail), value.dedupeKey ? text(value.dedupeKey).slice(0, 300) : null);
    return result.changes ? Number(result.lastInsertRowid) : null;
  }

  rememberArtists(artists) {
    if (!Array.isArray(artists) || !artists.length) return 0;
    let stored = 0;
    this.database.transaction(() => {
      for (const artist of artists) {
        if (this.upsertArtist(artist)) stored++;
      }
      if (stored) this.touch();
    });
    return stored;
  }

  recordReport(report, seedArtists = []) {
    if (!report || !Array.isArray(report.candidates)) return { stored: false, error: 'invalid-report' };
    const seeds = new Map();
    for (const entry of Array.isArray(seedArtists) ? seedArtists : []) {
      const id = mbid(entry?.id);
      if (id && entry?.name) seeds.set(id, entry);
    }
    let candidates = 0;
    let links = 0;
    let mappings = 0;
    this.database.transaction(() => {
      for (const seed of Array.isArray(report.seedIds) ? report.seedIds : []) {
        const artist = seeds.get(seed);
        if (artist) this.upsertArtist(artist);
      }
      for (const candidate of report.candidates) {
        const metadata = candidate?.recording;
        const recordingId = metadata?.title
          ? this.upsertRecording(metadata)
          : this.ensureRecording(candidate?.id);
        if (!recordingId) continue;
        candidates++;
        const creditArtists = [];
        for (const entry of Array.isArray(metadata?.artists) ? metadata.artists : []) {
          const artistId = this.upsertArtist(entry);
          if (!artistId) continue;
          creditArtists.push(artistId);
          if (this.link({
            subjectType: 'artist', subjectId: artistId, predicate: 'performed',
            objectType: 'recording', objectId: recordingId, source: 'musicbrainz',
            basis: 'recording-credit', confidence: 'identifier', evidenceKey: 'musicbrainz-credit:' + candidate.id,
          })) links++;
        }
        let candidateArtistId = null;
        if (mbid(candidate?.artistId)) {
          candidateArtistId = this.upsertArtist({ id: candidate.artistId, name: candidate.artistName || candidate.artistId });
          if (candidateArtistId && !creditArtists.includes(candidateArtistId)) {
            if (this.link({
              subjectType: 'artist', subjectId: candidateArtistId, predicate: 'performed',
              objectType: 'recording', objectId: recordingId, source: 'listenbrainz-radio',
              basis: 'similar-artist', confidence: 'reported', evidenceKey: 'listenbrainz-artist:' + candidate.id,
            })) links++;
          }
        }

        for (const tag of arrayOfTags(metadata)) {
          if (this.tagEntity({
            entityType: 'recording', entityId: recordingId, name: tag.name, kind: tag.kind,
            source: 'musicbrainz', basis: 'metadata', confidence: 'tagged',
          })) links++;
        }

        const groups = new Map();
        for (const group of Array.isArray(metadata?.releaseGroups) ? metadata.releaseGroups : []) {
          const groupId = this.upsertReleaseGroup(group);
          if (groupId) groups.set(mbid(group?.id), groupId);
        }
        for (const release of Array.isArray(metadata?.releases) ? metadata.releases : []) {
          let groupId = mbid(release?.groupId) ? groups.get(mbid(release.groupId)) : null;
          if (!groupId && release?.groupId) {
            const group = (metadata.releaseGroups || []).find((entry) => mbid(entry.id) === mbid(release.groupId));
            if (group) groupId = this.upsertReleaseGroup(group);
          }
          const releaseId = this.upsertRelease(release, groupId);
          if (!releaseId) continue;
          if (groupId) {
            if (this.link({
              subjectType: 'release_group', subjectId: groupId, predicate: 'has_release',
              objectType: 'release', objectId: releaseId, source: 'musicbrainz',
              basis: 'release-edition', confidence: 'identifier',
              evidenceKey: 'musicbrainz-release:' + (release.id || releaseId),
            })) links++;
            for (const artistId of creditArtists) {
              if (this.link({
                subjectType: 'artist', subjectId: artistId, predicate: 'associated_with',
                objectType: 'release_group', objectId: groupId, source: 'musicbrainz',
                basis: 'recording-credit', confidence: 'identifier',
                evidenceKey: 'musicbrainz-album:' + (release.id || releaseId) + ':' + artistId,
              })) links++;
            }
          }
          if (this.link({
            subjectType: 'release', subjectId: releaseId, predicate: 'contains',
            objectType: 'recording', objectId: recordingId, source: 'musicbrainz',
            basis: 'release-catalog', confidence: 'identifier',
            evidenceKey: 'musicbrainz-contains:' + (release.id || releaseId),
          })) links++;
          if (numberOrNull(release.mediumPosition) && numberOrNull(release.trackPosition)) {
            this.upsertReleaseTrack({
              releaseId, recordingId, mediumPosition: release.mediumPosition,
              trackPosition: release.trackPosition, title: metadata?.title, durationMs: metadata?.durationMs,
            });
          }
        }

        for (const seedId of Array.isArray(candidate?.seedArtistIds) ? candidate.seedArtistIds : []) {
          const seedArtistId = seeds.has(seedId) ? this.upsertArtist(seeds.get(seedId)) : null;
          if (!seedArtistId) continue;
          if (candidateArtistId && this.link({
            subjectType: 'artist', subjectId: seedArtistId, predicate: 'recommends',
            objectType: 'artist', objectId: candidateArtistId, source: 'listenbrainz-radio',
            basis: 'radio', confidence: 'reported',
            detail: { mode: report.mode, seed: seedId },
            evidenceKey: 'seed:' + seedId,
          })) links++;
          if (this.link({
            subjectType: 'artist', subjectId: seedArtistId, predicate: 'recommends',
            objectType: 'recording', objectId: recordingId, source: 'listenbrainz-radio',
            basis: 'radio', confidence: 'reported',
            detail: { mode: report.mode, seed: seedId },
            evidenceKey: 'seed:' + seedId,
          })) links++;
        }

        const choice = candidate?.match?.status === 'matched' ? candidate.match.choice : null;
        if (choice?.track) {
          const mappingId = this.mapProvider({
            entityType: 'recording', entityId: recordingId, provider: 'zvuk',
            providerId: String(choice.track.id), parentId: choice.track.albumId ? String(choice.track.albumId) : '',
            basis: 'catalog-track', confidence: choice.confidence || 'metadata',
            evidenceKey: 'catalog:' + (choice.track.id || ''),
          });
          if (mappingId) mappings++;
        }
        const vote = candidate?.feedback;
        if (vote === 'like' || vote === 'dislike') {
          this.rate({ entityType: 'recording', entityId: recordingId, source: 'discovery', value: vote === 'like' ? 1 : -1 });
        }
      }
      this.touch();
    });
    return { stored: true, candidates, links, mappings };
  }

  recordVote(recordingMbid, vote) {
    const id = mbid(recordingMbid);
    if (!id) return false;
    let stored = false;
    this.database.transaction(() => {
      const recordingId = this.ensureRecording(id);
      if (!recordingId) return;
      if (vote === 'like' || vote === 'dislike') {
        stored = this.rate({
          entityType: 'recording', entityId: recordingId, source: 'discovery',
          value: vote === 'like' ? 1 : -1,
        });
      } else {
        // Clearing a vote must also remove the migrated Alpha.1 legacy rating.
        stored = this.rate({ entityType: 'recording', entityId: recordingId, source: 'discovery', value: 0 });
        this.rate({ entityType: 'recording', entityId: recordingId, source: 'discovery-legacy', value: 0 });
      }
      this.touch();
    });
    return stored;
  }

  recordChoice(recordingMbid, track) {
    const id = mbid(recordingMbid);
    if (!id || !track?.id) return false;
    let stored = false;
    this.database.transaction(() => {
      const recordingId = this.ensureRecording(id);
      if (!recordingId) return;
      stored = Boolean(this.mapProvider({
        entityType: 'recording', entityId: recordingId, provider: 'zvuk',
        providerId: String(track.id), parentId: track.albumId ? String(track.albumId) : '',
        basis: 'manual-choice', confidence: 'confirmed', evidenceKey: 'choice:' + String(track.id),
        force: true,
      }));
      this.touch();
    });
    return stored;
  }

  recordPlayback(value) {
    if (!value?.type) return false;
    let stored = false;
    this.database.transaction(() => {
      const provider = value.provider || (String(value.trackId || '').startsWith('local-') ? 'local' : 'zvuk');
      const mapping = value.trackId
        ? this.findMapping('recording', provider, String(value.trackId)) : null;
      stored = Boolean(this.event({
        type: value.type, entityType: 'recording', entityId: mapping?.entity_id,
        recordingId: mapping?.entity_id, provider, providerTrackId: value.trackId,
        positionMs: value.positionMs, durationMs: value.durationMs, playedMs: value.playedMs,
        detail: { ...(value.detail && typeof value.detail === 'object' ? value.detail : {}),
          title: text(value.title), artist: text(value.artist) },
        dedupeKey: value.dedupeKey,
      }));
      if (stored) this.touch();
    });
    return stored;
  }

  recordFavorite(track, liked) {
    if (!track?.id) return false;
    const provider = String(track.id).startsWith('local-') ? 'local' : 'zvuk';
    let stored = false;
    this.database.transaction(() => {
      const mapping = this.findMapping('recording', provider, String(track.id));
      stored = Boolean(this.event({
        type: liked ? 'like' : 'unlike', entityType: 'recording', entityId: mapping?.entity_id,
        recordingId: mapping?.entity_id, provider, providerTrackId: String(track.id),
        detail: { title: text(track.title), artist: text(track.artist), via: 'favorite' },
        dedupeKey: `favorite:${provider}:${track.id}:${liked ? 1 : 0}:${Math.floor(Date.now() / 1000)}`,
      }));
      if (mapping?.entity_id) {
        this.rate({
          entityType: 'recording', entityId: mapping.entity_id, source: 'player',
          value: liked ? 1 : 0,
        });
      }
      if (stored) this.touch();
    });
    return stored;
  }

  importVotes(votes) {
    if (!votes || typeof votes !== 'object') return 0;
    let imported = 0;
    this.database.transaction(() => {
      for (const [id, vote] of Object.entries(votes)) {
        const recordingId = mbid(id);
        if (!recordingId || !['like', 'dislike'].includes(vote)) continue;
        const entityId = this.ensureRecording(recordingId);
        if (!entityId) continue;
        if (this.rate({ entityType: 'recording', entityId, source: 'discovery-legacy',
          value: vote === 'like' ? 1 : -1 })) imported++;
      }
      if (imported) this.touch();
    });
    return imported;
  }

  counts() {
    const one = (query) => Number(this.sql(query).get()?.count || 0);
    return {
      artists: one('SELECT COUNT(*) AS count FROM artist'),
      recordings: one('SELECT COUNT(*) AS count FROM recording'),
      releaseGroups: one('SELECT COUNT(*) AS count FROM release_group'),
      releases: one('SELECT COUNT(*) AS count FROM release'),
      releaseTracks: one('SELECT COUNT(*) AS count FROM release_track'),
      tags: one('SELECT COUNT(*) AS count FROM tag'),
      relations: one('SELECT COUNT(*) AS count FROM relation'),
      mappings: one('SELECT COUNT(*) AS count FROM provider_mapping'),
      ratings: one('SELECT COUNT(*) AS count FROM rating'),
      events: one('SELECT COUNT(*) AS count FROM user_event'),
    };
  }

  lastUpdated() {
    try {
      return this.sql("SELECT value FROM graph_meta WHERE key = 'last_updated'").get()?.value || null;
    } catch {
      return this.lastSeenAt;
    }
  }
}

function arrayOfTags(metadata) {
  const values = new Map();
  for (const [source, kind] of [[metadata?.genres, 'genre'], [metadata?.tags, 'tag']]) {
    for (const entry of Array.isArray(source) ? source : []) {
      const name = typeof entry === 'string' ? entry : entry?.name;
      if (name) values.set(kind + '\u0000' + name, { name, kind });
    }
  }
  return [...values.values()];
}

function numberOrNull(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

module.exports = { GraphRepository, normalizeKey };
