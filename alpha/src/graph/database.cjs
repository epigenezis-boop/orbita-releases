'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { SCHEMA_VERSION, migrations } = require('./schema.cjs');

const BUSY_TIMEOUT_MS = 3000;
const SAFETY_LIMIT_MS = 5000;
const SAFETY_BUSY_TIMEOUT_MS = 5000;

function isCorruptionError(error) {
  if (!error) return false;
  const code = typeof error.errcode === 'number' ? error.errcode & 0xff : null;
  if (code === 11 || code === 26) return true;
  const message = String(error.message || '').toLowerCase();
  return message.includes('not a database') ||
    message.includes('malformed') ||
    message.includes('corrupt') ||
    message.includes('encrypted');
}

function errorCode(error) {
  if (!error) return 'unknown';
  if (typeof error.errcode === 'number') return 'sqlite-' + error.errcode;
  if (typeof error.code === 'string' && error.code) return error.code;
  return 'error';
}

function safeLog(logger, code, detail) {
  if (typeof logger !== 'function') return;
  try {
    logger(code, detail);
  } catch {
    // Diagnostics must never break database access.
  }
}

function nowIso() {
  return new Date().toISOString();
}

function closeQuietly(raw) {
  if (!raw) return;
  try { raw.close(); } catch { /* already closed or unusable */ }
}

function renameIfPresent(from, to) {
  try {
    if (!fs.existsSync(from)) return;
    fs.renameSync(from, to);
  } catch {
    // The quarantine pass is best effort; the fresh database is still isolated.
  }
}

function quarantine(file) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const extension = path.extname(file);
  const stem = extension ? file.slice(0, -extension.length) : file;
  let target = stem + '.corrupt-' + stamp + '.sqlite';
  let attempt = 1;
  while (fs.existsSync(target)) {
    target = stem + '.corrupt-' + stamp + '-' + attempt + '.sqlite';
    attempt += 1;
  }
  renameIfPresent(file, target);
  renameIfPresent(file + '-wal', target + '-wal');
  renameIfPresent(file + '-shm', target + '-shm');
  return target;
}

function runQuickCheck(raw) {
  try {
    const rows = raw.prepare('PRAGMA quick_check').all();
    const ok = rows.length > 0 && rows.every((row) => {
      const values = Object.values(row);
      return values.length === 1 && String(values[0]).toLowerCase() === 'ok';
    });
    return { ok, corruption: !ok, error: null };
  } catch (error) {
    return { ok: false, corruption: isCorruptionError(error), error };
  }
}

function configurePragmas(raw, logger) {
  const failures = [];
  let wal = false;

  try {
    const row = raw.prepare('PRAGMA journal_mode = WAL').get();
    wal = String(row?.journal_mode || '').toLowerCase() === 'wal';
    if (!wal) safeLog(logger, 'graph-wal-unavailable', String(row?.journal_mode || 'unknown'));
  } catch (error) {
    failures.push('journal_mode');
    safeLog(logger, 'graph-pragma-failed', 'journal_mode:' + errorCode(error));
  }

  const apply = (name, sql) => {
    try {
      raw.exec(sql);
    } catch (error) {
      failures.push(name);
      safeLog(logger, 'graph-pragma-failed', name + ':' + errorCode(error));
    }
  };

  apply('synchronous', 'PRAGMA synchronous = NORMAL');
  apply('foreign_keys', 'PRAGMA foreign_keys = ON');
  apply('busy_timeout', 'PRAGMA busy_timeout = ' + BUSY_TIMEOUT_MS);

  if (!failures.includes('foreign_keys')) {
    try {
      const row = raw.prepare('PRAGMA foreign_keys').get();
      if (Number(row?.foreign_keys) !== 1) {
        failures.push('foreign_keys');
        safeLog(logger, 'graph-pragma-failed', 'foreign_keys:not-enabled');
      }
    } catch (error) {
      failures.push('foreign_keys');
      safeLog(logger, 'graph-pragma-failed', 'foreign_keys:' + errorCode(error));
    }
  }

  return { failures, wal };
}

function makeBackup(raw, file, version, logger) {
  const directory = path.dirname(file);
  const base = path.basename(file);
  const stem = base.toLowerCase().endsWith('.sqlite') ? base.slice(0, -'.sqlite'.length) : base;
  const backup = path.join(directory, stem + '.backup-v' + version + '.sqlite');

  // Keep at most one backup per database: remove stale versions of the same file.
  for (const entry of fs.readdirSync(directory)) {
    const candidate = path.join(directory, entry);
    if (candidate === backup) continue;
    if (entry.startsWith(stem + '.backup-v') && entry.endsWith('.sqlite')) {
      try { fs.rmSync(candidate, { force: true }); } catch { /* best effort */ }
    }
  }

  try { raw.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
  catch (error) { safeLog(logger, 'graph-backup-checkpoint-failed', errorCode(error)); }

  fs.copyFileSync(file, backup);
  return backup;
}

function applyMigrations(raw, currentVersion, logger) {
  const pending = migrations
    .filter((migration) => migration.version > currentVersion)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error('Invalid migration version');
    }
    if (typeof migration.sql !== 'string' || !migration.sql.trim()) {
      throw new Error('Invalid migration SQL');
    }
    raw.exec('BEGIN IMMEDIATE');
    try {
      raw.exec(migration.sql);
      raw.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, nowIso());
      // PRAGMA statements cannot take bound parameters; the value is a local integer.
      raw.exec('PRAGMA user_version = ' + migration.version);
      raw.exec('COMMIT');
    } catch (error) {
      try { raw.exec('ROLLBACK'); }
      catch (rollbackError) { safeLog(logger, 'graph-rollback-failed', errorCode(rollbackError)); }
      throw error;
    }
  }

  return pending.length;
}

function readUserVersion(raw) {
  const row = raw.prepare('PRAGMA user_version').get();
  const version = Number(row?.user_version ?? 0);
  if (!Number.isInteger(version) || version < 0) throw new Error('Invalid user_version');
  return version;
}

function unavailableHandle(file, status) {
  const noopStatement = {
    run: () => ({ changes: 0, lastInsertRowid: 0 }),
    get: () => undefined,
    all: () => [],
    iterate: () => [][Symbol.iterator](),
  };
  const validateSql = (sql) => {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new TypeError('Graph database SQL must be a non-empty string');
    }
  };
  return {
    path: file,
    raw: null,
    status,
    prepare(sql) {
      validateSql(sql);
      return noopStatement;
    },
    exec(sql) {
      validateSql(sql);
    },
    transaction(fn) {
      if (typeof fn !== 'function') throw new TypeError('transaction expects a function');
      return undefined;
    },
    integrityCheck: () => false,
    sizeBytes: () => 0,
    close() { /* nothing to close */ },
  };
}

function openGraphDatabase(file, options = {}) {
  if (typeof file !== 'string' || !file.trim()) {
    throw new TypeError('openGraphDatabase requires a non-empty file path');
  }
  if (options === null || typeof options !== 'object') {
    throw new TypeError('openGraphDatabase options must be an object');
  }
  const logger = options.logger;
  if (logger !== undefined && typeof logger !== 'function') {
    throw new TypeError('openGraphDatabase logger must be a function');
  }

  const target = path.resolve(file);
  const unavailable = (created, recovered, schemaVersion, error) => unavailableHandle(target, {
    available: false,
    created,
    recovered,
    schemaVersion,
    error,
  });

  let sqlite;
  try {
    sqlite = require('node:sqlite');
  } catch (error) {
    safeLog(logger, 'graph-sqlite-unavailable', errorCode(error));
    return unavailable(false, false, 0, 'sqlite-unavailable');
  }
  if (typeof sqlite.DatabaseSync !== 'function') {
    safeLog(logger, 'graph-sqlite-unavailable', 'DatabaseSync-missing');
    return unavailable(false, false, 0, 'sqlite-unavailable');
  }

  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch (error) {
    safeLog(logger, 'graph-directory-failed', errorCode(error));
    return unavailable(false, false, 0, 'graph-open-failed');
  }

  const existed = fs.existsSync(target);
  const created = !existed;
  let recovered = false;
  let raw = null;
  let existingBytes = 0;
  if (existed) {
    for (const suffix of ['', '-wal', '-shm']) {
      try { existingBytes += fs.statSync(target + suffix).size; }
      catch { /* absent sidecar */ }
    }
  }

  try {
    raw = new sqlite.DatabaseSync(target);
  } catch (error) {
    if (!existed || !isCorruptionError(error)) {
      safeLog(logger, 'graph-open-failed', errorCode(error));
      return unavailable(created, false, 0, 'graph-open-failed');
    }
    raw = null;
  }

  if (raw && existed) {
    const check = runQuickCheck(raw);
    if (!check.ok) {
      closeQuietly(raw);
      raw = null;
      if (!check.corruption) {
        safeLog(logger, 'graph-open-failed', errorCode(check.error));
        return unavailable(created, false, 0, 'graph-open-failed');
      }
    }
  }

  if (!raw) {
    // A corrupt database is renamed next to the original, never deleted or merged.
    try {
      quarantine(target);
      recovered = true;
      raw = new sqlite.DatabaseSync(target);
    } catch (error) {
      closeQuietly(raw);
      safeLog(logger, 'graph-open-failed', errorCode(error));
      return unavailable(created, recovered, 0, 'graph-open-failed');
    }
  }

  // Read the version before any pragma so a newer schema is never rewritten.
  let version;
  try {
    version = readUserVersion(raw);
  } catch (error) {
    closeQuietly(raw);
    safeLog(logger, 'graph-open-failed', errorCode(error));
    return unavailable(created, recovered, 0, 'graph-open-failed');
  }

  if (version > SCHEMA_VERSION) {
    closeQuietly(raw);
    safeLog(logger, 'graph-schema-newer', 'user_version-' + version);
    return unavailable(created, recovered, version, 'schema-newer');
  }

  const startedAt = Date.now();
  const { failures } = configurePragmas(raw, logger);
  if (failures.length > 0) {
    // If a pragma fails the connection may be waiting on an outside lock; cap it.
    try { raw.exec('PRAGMA busy_timeout = ' + SAFETY_BUSY_TIMEOUT_MS); } catch { /* best effort */ }
    safeLog(logger, 'graph-pragma-degraded', failures.join(','));
    if (Date.now() - startedAt > SAFETY_LIMIT_MS) {
      closeQuietly(raw);
      safeLog(logger, 'graph-open-failed', 'open-deadline');
      return unavailable(created, recovered, 0, 'graph-open-failed');
    }
  }

  try {
    if (version < SCHEMA_VERSION && existed && !recovered && existingBytes > 0) {
      makeBackup(raw, target, version, logger);
    }
    applyMigrations(raw, version, logger);
    version = readUserVersion(raw);
    if (version !== SCHEMA_VERSION) throw new Error('Schema version mismatch after migration');
  } catch (error) {
    closeQuietly(raw);
    safeLog(logger, 'graph-open-failed', errorCode(error));
    return unavailable(created, recovered, version || 0, 'graph-open-failed');
  }

  const status = {
    available: true,
    created,
    recovered,
    schemaVersion: version,
    error: null,
  };

  let depth = 0;
  let closed = false;

  function ensureOpen() {
    if (closed || !raw) throw new Error('Music graph database is closed');
  }

  function validateSql(sql) {
    if (typeof sql !== 'string' || !sql.trim()) {
      throw new TypeError('Graph database SQL must be a non-empty string');
    }
  }

  const handle = {
    path: target,
    raw,
    status,
    prepare(sql) {
      validateSql(sql);
      ensureOpen();
      return raw.prepare(sql);
    },
    exec(sql) {
      validateSql(sql);
      ensureOpen();
      raw.exec(sql);
    },
    transaction(fn) {
      if (typeof fn !== 'function') throw new TypeError('transaction expects a function');
      ensureOpen();
      if (depth > 0) return fn();
      raw.exec('BEGIN IMMEDIATE');
      depth = 1;
      try {
        const result = fn();
        raw.exec('COMMIT');
        return result;
      } catch (error) {
        try { raw.exec('ROLLBACK'); }
        catch (rollbackError) { safeLog(logger, 'graph-rollback-failed', errorCode(rollbackError)); }
        throw error;
      } finally {
        depth = 0;
      }
    },
    integrityCheck() {
      if (closed || !raw) return false;
      return runQuickCheck(raw).ok;
    },
    sizeBytes() {
      let total = 0;
      for (const suffix of ['', '-wal', '-shm']) {
        try { total += fs.statSync(target + suffix).size; }
        catch { /* absent sidecar */ }
      }
      return total;
    },
    close() {
      if (closed) return;
      closed = true;
      const current = raw;
      raw = null;
      handle.raw = null;
      if (!current) return;
      try { current.exec('PRAGMA wal_checkpoint(TRUNCATE)'); }
      catch (error) { safeLog(logger, 'graph-checkpoint-failed', errorCode(error)); }
      closeQuietly(current);
    },
  };

  return handle;
}

module.exports = { openGraphDatabase };
