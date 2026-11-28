'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { openGraphDatabase } = require('../src/graph/database.cjs');
const { SCHEMA_VERSION } = require('../src/graph/schema.cjs');

const TABLES = [
  'artist',
  'cache_stats',
  'entity_tag',
  'external_cache',
  'graph_meta',
  'mapping_evidence',
  'provider_mapping',
  'rating',
  'recording',
  'recording_isrc',
  'relation',
  'relation_evidence',
  'release',
  'release_group',
  'release_track',
  'schema_migrations',
  'tag',
  'user_event',
];

const NOW = '2026-01-01T00:00:00.000Z';
const MBID = '11111111-1111-1111-1111-111111111111';

function makeDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'orbita-graph-'));
}

function removeDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

function insertArtist(db, mbid, nameKey, disambiguation = '') {
  db.prepare(
    'INSERT INTO artist (mbid, name, name_key, disambiguation, created_at, updated_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?)'
  ).run(mbid, nameKey, nameKey, disambiguation, NOW, NOW);
}

function tableNames(db) {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map((row) => row.name);
}

function count(db, table) {
  return db.prepare('SELECT count(*) AS n FROM ' + table).get().n;
}

test('creates schema v1 with WAL, foreign keys and MBID rules', () => {
  const directory = makeDirectory();
  const file = path.join(directory, 'music-graph.sqlite');
  let db;
  try {
    db = openGraphDatabase(file);
    assert.equal(db.status.available, true);
    assert.equal(db.status.created, true);
    assert.equal(db.status.recovered, false);
    assert.equal(db.status.schemaVersion, SCHEMA_VERSION);
    assert.equal(db.status.error, null);
    assert.equal(db.path, path.resolve(file));
    assert.ok(db.raw);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(db.integrityCheck(), true);

    const tables = tableNames(db);
    for (const name of TABLES) {
      assert.ok(tables.includes(name), 'missing table ' + name);
    }

    // Foreign keys are enforced, not just declared.
    assert.throws(
      () => db.prepare('INSERT INTO recording_isrc (isrc, recording_id) VALUES (?, ?)')
        .run('USAAA0000001', 9999),
      /FOREIGN KEY/
    );

    // A non-null MBID is unique.
    insertArtist(db, MBID, 'alpha');
    assert.throws(() => insertArtist(db, MBID, 'alpha duplicate'), /UNIQUE/);

    // Several local (NULL MBID) identities are allowed when name_key/disambiguation differ.
    insertArtist(db, null, 'local-one');
    insertArtist(db, null, 'local-two');
    insertArtist(db, null, 'local-one', 'different artist');
    assert.equal(count(db, 'artist'), 4);
  } finally {
    db?.close();
    removeDirectory(directory);
  }
});

test('migrations are idempotent on reopen', () => {
  const directory = makeDirectory();
  const file = path.join(directory, 'music-graph.sqlite');
  try {
    const first = openGraphDatabase(file);
    assert.equal(first.status.created, true);
    first.prepare('INSERT INTO graph_meta (key, value, updated_at) VALUES (?, ?, ?)')
      .run('seed', 'one', NOW);
    first.close();

    const second = openGraphDatabase(file);
    try {
      assert.equal(second.status.available, true);
      assert.equal(second.status.created, false);
      assert.equal(second.status.recovered, false);
      assert.equal(second.status.schemaVersion, 1);
      assert.equal(second.prepare('PRAGMA user_version').get().user_version, 1);
      assert.equal(count(second, 'schema_migrations'), 1);
      const versions = second.prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all().map((row) => row.version);
      assert.deepEqual(versions, [1]);
      assert.equal(second.prepare('SELECT value FROM graph_meta WHERE key = ?').get('seed').value, 'one');
    } finally {
      second.close();
    }
  } finally {
    removeDirectory(directory);
  }
});

test('transactions commit, roll back and reuse the outer transaction when nested', () => {
  const directory = makeDirectory();
  const file = path.join(directory, 'music-graph.sqlite');
  const db = openGraphDatabase(file);
  try {
    const insert = db.prepare('INSERT INTO graph_meta (key, value, updated_at) VALUES (?, ?, ?)');

    const result = db.transaction(() => {
      insert.run('outer', '1', NOW);
      db.transaction(() => insert.run('nested', '2', NOW));
      return 'committed';
    });
    assert.equal(result, 'committed');
    assert.equal(count(db, 'graph_meta'), 2);

    assert.throws(() => db.transaction(() => {
      insert.run('rollback-outer', '3', NOW);
      db.transaction(() => {
        insert.run('rollback-nested', '4', NOW);
        throw new Error('nested failure');
      });
    }), /nested failure/);
    assert.equal(count(db, 'graph_meta'), 2);
    assert.equal(
      db.prepare("SELECT count(*) AS n FROM graph_meta WHERE key LIKE 'rollback-%'").get().n,
      0
    );

    assert.throws(() => db.transaction(() => {
      db.transaction(() => insert.run('late', '5', NOW));
      throw new Error('late failure');
    }), /late failure/);
    assert.equal(count(db, 'graph_meta'), 2);
    assert.equal(db.prepare("SELECT count(*) AS n FROM graph_meta WHERE key = 'late'").get().n, 0);
  } finally {
    db.close();
    removeDirectory(directory);
  }
});

test('corrupt database is quarantined and replaced without touching neighbours', () => {
  const directory = makeDirectory();
  const file = path.join(directory, 'music-graph.sqlite');
  const neighbour = path.join(directory, 'keep-me.txt');
  try {
    fs.writeFileSync(file, 'this is definitely not a sqlite database\n'.repeat(200));
    fs.writeFileSync(neighbour, 'user data stays');

    const db = openGraphDatabase(file);
    try {
      assert.equal(db.status.available, true);
      assert.equal(db.status.recovered, true);
      assert.equal(db.status.schemaVersion, 1);
      assert.equal(db.status.error, null);
      assert.equal(db.integrityCheck(), true);
      for (const name of TABLES) {
        assert.ok(tableNames(db).includes(name), 'missing fresh table ' + name);
      }
      assert.equal(count(db, 'artist'), 0);
      assert.equal(count(db, 'schema_migrations'), 1);

      const quarantined = fs.readdirSync(directory).filter((name) => name.includes('.corrupt-'));
      assert.equal(quarantined.length, 1);
      assert.ok(quarantined[0].endsWith('.sqlite'));
      assert.equal(fs.readFileSync(neighbour, 'utf8'), 'user data stays');
    } finally {
      db.close();
    }
    assert.equal(fs.readFileSync(neighbour, 'utf8'), 'user data stays');
  } finally {
    removeDirectory(directory);
  }
});

test('a database from a newer schema is refused without modification', () => {
  const directory = makeDirectory();
  const file = path.join(directory, 'music-graph.sqlite');
  try {
    const first = openGraphDatabase(file);
    first.prepare('INSERT INTO graph_meta (key, value, updated_at) VALUES (?, ?, ?)')
      .run('marker', 'kept', NOW);
    first.close();

    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA user_version = 99');
    raw.close();

    const db = openGraphDatabase(file);
    assert.equal(db.status.available, false);
    assert.equal(db.status.error, 'schema-newer');
    assert.equal(db.status.schemaVersion, 99);
    assert.equal(db.raw, null);
    assert.equal(db.integrityCheck(), false);
    assert.equal(db.sizeBytes(), 0);
    // Unavailable handles are safe no-ops instead of throwing into callers.
    assert.equal(db.prepare('SELECT 1 AS one').all().length, 0);
    db.exec('DELETE FROM artist');
    assert.equal(db.transaction(() => 'ignored'), undefined);
    db.close();

    const verify = new DatabaseSync(file);
    try {
      assert.equal(verify.prepare('PRAGMA user_version').get().user_version, 99);
      assert.equal(verify.prepare('SELECT count(*) AS n FROM schema_migrations').get().n, 1);
      assert.equal(verify.prepare('SELECT value FROM graph_meta WHERE key = ?').get('marker').value, 'kept');
      assert.equal(verify.prepare(
        "SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'artist'"
      ).get().n, 1);
    } finally {
      verify.close();
    }
  } finally {
    removeDirectory(directory);
  }
});

test('a pending migration keeps exactly one backup of the existing file', () => {
  const directory = makeDirectory();
  const file = path.join(directory, 'music-graph.sqlite');
  try {
    const first = openGraphDatabase(file);
    first.prepare('INSERT INTO graph_meta (key, value, updated_at) VALUES (?, ?, ?)')
      .run('before-upgrade', 'kept', NOW);
    first.close();

    const raw = new DatabaseSync(file);
    raw.exec('PRAGMA user_version = 0');
    raw.close();
    fs.writeFileSync(path.join(directory, 'music-graph.backup-v9.sqlite'), 'stale backup');

    const db = openGraphDatabase(file);
    try {
      assert.equal(db.status.available, true);
      assert.equal(db.status.schemaVersion, 1);
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
      assert.equal(
        db.prepare('SELECT value FROM graph_meta WHERE key = ?').get('before-upgrade').value,
        'kept'
      );
    } finally {
      db.close();
    }

    const backups = fs.readdirSync(directory).filter((name) => name.includes('.backup-v'));
    assert.deepEqual(backups.sort(), ['music-graph.backup-v0.sqlite']);

    const backup = new DatabaseSync(path.join(directory, backups[0]));
    try {
      assert.equal(backup.prepare('PRAGMA user_version').get().user_version, 0);
      assert.equal(backup.prepare('SELECT count(*) AS n FROM graph_meta').get().n, 1);
    } finally {
      backup.close();
    }
  } finally {
    removeDirectory(directory);
  }
});

test('size accounting, idempotent close and persistence across reopen', () => {
  const directory = makeDirectory();
  const file = path.join(directory, 'music-graph.sqlite');
  try {
    const first = openGraphDatabase(file);
    insertArtist(first, null, 'persisted');
    assert.ok(first.sizeBytes() > 0);

    first.close();
    assert.equal(first.raw, null);
    assert.ok(first.sizeBytes() > 0);
    first.close();
    first.close();

    const second = openGraphDatabase(file);
    try {
      assert.equal(second.status.created, false);
      assert.equal(second.status.recovered, false);
      assert.equal(second.status.available, true);
      assert.equal(second.prepare('SELECT name_key FROM artist').get().name_key, 'persisted');
    } finally {
      second.close();
    }
  } finally {
    removeDirectory(directory);
  }
});
