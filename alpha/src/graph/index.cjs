'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { openGraphDatabase } = require('./database.cjs');
const { GraphRepository } = require('./repository.cjs');

const DAY = 24 * 60 * 60_000;
const MAX_PAYLOAD = 2 * 1024 * 1024;
const MAX_ENTRIES = 5000;
const SEARCH_TTL = 6 * 60 * 60_000;

function clampTtl(value) {
  return Number.isFinite(value) ? Math.max(60_000, Math.min(30 * DAY, Math.round(value))) : SEARCH_TTL;
}

function normalizeQuery(query) {
  return String(query || '').trim().toLowerCase().slice(0, 220);
}

function createCache(database, log) {
  const pending = new Map();
  let operations = 0;
  let puts = 0;

  const bucket = (provider) => {
    let value = pending.get(provider);
    if (!value) {
      value = { hits: 0, misses: 0, writes: 0, evictions: 0 };
      pending.set(provider, value);
    }
    return value;
  };

  function flush() {
    if (!pending.size) return;
    try {
      const at = new Date().toISOString();
      database.transaction(() => {
        for (const [provider, value] of pending) {
          database.prepare(`INSERT INTO cache_stats(provider, hits, misses, writes, evictions, updated_at)
            VALUES(?, ?, ?, ?, ?, ?) ON CONFLICT(provider) DO UPDATE SET
              hits = cache_stats.hits + excluded.hits,
              misses = cache_stats.misses + excluded.misses,
              writes = cache_stats.writes + excluded.writes,
              evictions = cache_stats.evictions + excluded.evictions,
              updated_at = excluded.updated_at`)
            .run(provider, value.hits, value.misses, value.writes, value.evictions, at);
        }
      });
      pending.clear();
    } catch (error) {
      log('cache-stats-failed', { code: error.code || 'internal' });
    }
  }

  const keyOf = (provider, scope, key) => `${provider}\u0000${String(scope || '')}\u0000${String(key)}`;

  function prune(force = false) {
    if (!force && puts % 25 !== 0) return;
    try {
      const at = Date.now();
      const removed = database.prepare('DELETE FROM external_cache WHERE expires_at <= ?').run(at).changes;
      if (removed) bucket('maintenance').evictions += removed;
      const total = Number(database.prepare('SELECT COUNT(*) AS count FROM external_cache').get()?.count || 0);
      if (total > MAX_ENTRIES) {
        const extra = database.prepare(`DELETE FROM external_cache WHERE key IN (
          SELECT key FROM external_cache ORDER BY last_used_at ASC LIMIT ?)`).run(total - MAX_ENTRIES).changes;
        if (extra) bucket('maintenance').evictions += extra;
      }
    } catch (error) {
      log('cache-prune-failed', { code: error.code || 'internal' });
    }
  }

  return {
    get(provider, key, scope = '') {
      if (!database?.status?.available) return null;
      const composite = keyOf(provider, scope, key);
      operations++;
      try {
        const row = database.prepare('SELECT payload, expires_at FROM external_cache WHERE key = ?').get(composite);
        if (!row || row.expires_at <= Date.now()) {
          if (row) {
            try { database.prepare('DELETE FROM external_cache WHERE key = ?').run(composite); }
            catch { /* cache cleanup is best effort */ }
          }
          bucket(provider).misses++;
          return null;
        }
        const payload = JSON.parse(row.payload);
        bucket(provider).hits++;
        if (operations % 40 === 0) {
          database.prepare('UPDATE external_cache SET last_used_at = ?, hits = hits + 1 WHERE key = ?')
            .run(new Date().toISOString(), composite);
        }
        return payload;
      } catch (error) {
        bucket(provider).misses++;
        log('cache-read-failed', { code: error.code || 'internal' });
        return null;
      }
    },
    put(provider, key, scope, payload, ttlMs, route = '') {
      if (!database?.status?.available || payload === null || payload === undefined) return false;
      const composite = keyOf(provider, scope, key);
      if (composite.length > 4096) return false;
      let encoded;
      try { encoded = JSON.stringify(payload); }
      catch { return false; }
      if (typeof encoded !== 'string' || encoded.length > MAX_PAYLOAD) return false;
      const ttl = clampTtl(ttlMs);
      const at = new Date().toISOString();
      try {
        database.prepare(`INSERT INTO external_cache(key, provider, route, scope, origin, payload,
          created_at, expires_at, last_used_at, hits) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(key) DO UPDATE SET provider = excluded.provider, route = excluded.route,
            scope = excluded.scope, origin = excluded.origin, payload = excluded.payload,
            created_at = excluded.created_at, expires_at = excluded.expires_at,
            last_used_at = excluded.last_used_at, hits = 0`)
          .run(composite, String(provider), String(route).slice(0, 500), String(scope || '').slice(0, 200),
            'external', encoded, at, Date.now() + ttl, at);
        bucket(provider).writes++;
        puts++;
        prune();
        return true;
      } catch (error) {
        log('cache-write-failed', { code: error.code || 'internal' });
        return false;
      }
    },
    getSearch(scope, query) {
      return this.get('zvuk-search', normalizeQuery(query), scope);
    },
    putSearch(scope, query, tracks) {
      if (!Array.isArray(tracks)) return false;
      return this.put('zvuk-search', normalizeQuery(query), scope,
        tracks.slice(0, 120), SEARCH_TTL, '/search');
    },
    stats() {
      flush();
      try {
        const rows = database.prepare('SELECT provider, hits, misses, writes, evictions FROM cache_stats').all();
        const stats = { hits: 0, misses: 0, writes: 0, evictions: 0, entries: 0, providers: {} };
        for (const row of rows) {
          stats.hits += row.hits;
          stats.misses += row.misses;
          stats.writes += row.writes;
          stats.evictions += row.evictions;
          stats.providers[row.provider] = {
            hits: row.hits, misses: row.misses, writes: row.writes, evictions: row.evictions,
          };
        }
        stats.entries = Number(database.prepare('SELECT COUNT(*) AS count FROM external_cache').get()?.count || 0);
        return stats;
      } catch (error) {
        log('cache-stats-read-failed', { code: error.code || 'internal' });
        return { hits: 0, misses: 0, writes: 0, evictions: 0, entries: 0, providers: {} };
      }
    },
    clear() {
      flush();
      try {
        const removed = database.prepare('DELETE FROM external_cache').run().changes;
        return removed;
      } catch (error) {
        log('cache-clear-failed', { code: error.code || 'internal' });
        return 0;
      }
    },
    flush,
  };
}

function readLegacyVotes(file) {
  if (!file) return {};
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (saved?.schema !== 1 || !saved.votes || typeof saved.votes !== 'object') return {};
    return saved.votes;
  } catch {
    return {};
  }
}

function openMusicGraph({ profileDir, legacyFeedbackFile, diagnostics, file }) {
  const log = (code, extra = {}) => {
    try { diagnostics?.add?.('music-graph', { stage: code, ...extra }); }
    catch { /* diagnostics must never break storage */ }
  };
  const target = file || path.join(profileDir, 'music-graph.sqlite');
  let database;
  let repository;
  let cache;
  let importedVotes = 0;
  let available = false;
  let error = 'graph-unavailable';
  let recovered = false;
  let schemaVersion = 0;

  try {
    database = openGraphDatabase(target, { logger: log });
    available = Boolean(database?.status?.available);
    recovered = Boolean(database?.status?.recovered);
    schemaVersion = Number(database?.status?.schemaVersion || 0);
    error = available ? null : (database?.status?.error || 'graph-unavailable');
    if (available) {
      repository = new GraphRepository(database);
      cache = createCache(database, log);
      const votes = readLegacyVotes(legacyFeedbackFile);
      if (Object.keys(votes).length) {
        try { importedVotes = repository.importVotes(votes); }
        catch (cause) {
          log('legacy-import-failed', { code: cause.code || 'internal' });
        }
      }
      if (importedVotes) log('legacy-imported', { count: importedVotes });
    }
  } catch (cause) {
    available = false;
    error = 'graph-open-failed';
    log('open-failed', { code: cause.code || 'internal' });
    try { database?.close?.(); } catch { /* ignore */ }
  }

  const guard = (work, fallback) => {
    if (!available) return fallback;
    try { return work(); }
    catch (cause) {
      log('write-failed', { code: cause.code || 'internal' });
      return fallback;
    }
  };

  return {
    get available() { return available; },
    get error() { return available ? null : error; },
    get recovered() { return recovered; },
    get schemaVersion() { return schemaVersion; },
    get importedVotes() { return importedVotes; },
    file: path.basename(target),
    path: target,
    cache: cache || {
      get: () => null,
      put: () => false,
      getSearch: () => null,
      putSearch: () => false,
      stats: () => ({ hits: 0, misses: 0, writes: 0, evictions: 0, entries: 0, providers: {} }),
      clear: () => 0,
      flush: () => {},
    },
    rememberArtists(artists) {
      return guard(() => repository.rememberArtists(artists), 0);
    },
    recordReport(report, seedArtists) {
      if (!available) return { stored: false, error: 'graph-unavailable' };
      try { return repository.recordReport(report, seedArtists); }
      catch (cause) {
        log('report-failed', { code: cause.code || 'internal' });
        return { stored: false, error: 'graph-storage' };
      }
    },
    recordVote(id, vote) {
      return guard(() => repository.recordVote(id, vote), false);
    },
    recordChoice(id, track) {
      return guard(() => repository.recordChoice(id, track), false);
    },
    recordPlayback(event) {
      return guard(() => repository.recordPlayback(event), false);
    },
    recordFavorite(track, liked) {
      return guard(() => repository.recordFavorite(track, liked), false);
    },
    stats() {
      if (!available) {
        return {
          available: false, schemaVersion: 0, file: path.basename(target), dbSizeBytes: 0,
          counts: emptyCounts(), cache: emptyCache(), lastUpdated: null, recovered: false, error,
        };
      }
      try {
        return {
          available: true, schemaVersion, file: path.basename(target),
          dbSizeBytes: database.sizeBytes(),
          counts: repository.counts(), cache: cache.stats(),
          lastUpdated: repository.lastUpdated(), recovered, error: null,
        };
      } catch (cause) {
        log('stats-failed', { code: cause.code || 'internal' });
        return {
          available: false, schemaVersion, file: path.basename(target), dbSizeBytes: 0,
          counts: emptyCounts(), cache: emptyCache(), lastUpdated: null, recovered,
          error: 'graph-stats-failed',
        };
      }
    },
    clearCache() {
      if (!available) return { cleared: 0, error: 'graph-unavailable' };
      const cleared = cache.clear();
      return { cleared, stats: this.stats() };
    },
    close() {
      if (!available) return;
      try { cache.flush(); } catch { /* ignore */ }
      try { database.close(); } catch (cause) { log('close-failed', { code: cause.code || 'internal' }); }
      available = false;
    },
  };
}

function emptyCounts() {
  return {
    artists: 0, recordings: 0, releaseGroups: 0, releases: 0, releaseTracks: 0,
    tags: 0, relations: 0, mappings: 0, ratings: 0, events: 0,
  };
}

function emptyCache() {
  return { hits: 0, misses: 0, writes: 0, evictions: 0, entries: 0, providers: {} };
}

module.exports = { openMusicGraph };
