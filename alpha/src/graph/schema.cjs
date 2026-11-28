'use strict';

// Forward-only migrations for the local music graph. Each statement is applied
// inside a single transaction by database.cjs; `PRAGMA user_version` mirrors the
// highest applied version. No user data may be interpolated into this SQL.

const SCHEMA_VERSION = 1;

const migrations = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS graph_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artist (
  id INTEGER PRIMARY KEY,
  mbid TEXT UNIQUE,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  disambiguation TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  area TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  begin_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (mbid IS NULL OR length(mbid) = 36)
);

CREATE UNIQUE INDEX IF NOT EXISTS artist_local_identity
  ON artist(name_key, disambiguation) WHERE mbid IS NULL;

CREATE TABLE IF NOT EXISTS recording (
  id INTEGER PRIMARY KEY,
  mbid TEXT UNIQUE,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  disambiguation TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (mbid IS NULL OR length(mbid) = 36),
  CHECK (duration_ms IS NULL OR duration_ms > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS recording_local_identity
  ON recording(title_key, disambiguation) WHERE mbid IS NULL;

CREATE TABLE IF NOT EXISTS recording_isrc (
  isrc TEXT PRIMARY KEY,
  recording_id INTEGER NOT NULL REFERENCES recording(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS release_group (
  id INTEGER PRIMARY KEY,
  mbid TEXT UNIQUE,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  primary_type TEXT NOT NULL DEFAULT '',
  secondary_types TEXT NOT NULL DEFAULT '[]',
  first_release_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (mbid IS NULL OR length(mbid) = 36)
);

CREATE UNIQUE INDEX IF NOT EXISTS release_group_local_identity
  ON release_group(title_key, primary_type) WHERE mbid IS NULL;

CREATE TABLE IF NOT EXISTS release (
  id INTEGER PRIMARY KEY,
  mbid TEXT UNIQUE,
  release_group_id INTEGER REFERENCES release_group(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  title_key TEXT NOT NULL,
  date TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (mbid IS NULL OR length(mbid) = 36)
);

CREATE UNIQUE INDEX IF NOT EXISTS release_local_identity
  ON release(title_key, date, release_group_id) WHERE mbid IS NULL;

CREATE TABLE IF NOT EXISTS release_track (
  id INTEGER PRIMARY KEY,
  release_id INTEGER NOT NULL REFERENCES release(id) ON DELETE CASCADE,
  recording_id INTEGER NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
  medium_position INTEGER,
  track_position INTEGER,
  title TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (medium_position IS NULL OR medium_position > 0),
  CHECK (track_position IS NULL OR track_position > 0),
  CHECK (duration_ms IS NULL OR duration_ms > 0),
  UNIQUE (release_id, medium_position, track_position)
);

CREATE TABLE IF NOT EXISTS tag (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS relation (
  id INTEGER PRIMARY KEY,
  subject_type TEXT NOT NULL,
  subject_id INTEGER NOT NULL,
  predicate TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 1 CHECK (confirmations > 0),
  UNIQUE (subject_type, subject_id, predicate, object_type, object_id, source)
);

CREATE INDEX IF NOT EXISTS relation_subject
  ON relation(subject_type, subject_id, predicate);
CREATE INDEX IF NOT EXISTS relation_object
  ON relation(object_type, object_id, predicate);

CREATE TABLE IF NOT EXISTS relation_evidence (
  relation_id INTEGER NOT NULL REFERENCES relation(id) ON DELETE CASCADE,
  evidence_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (relation_id, evidence_key)
);

CREATE TABLE IF NOT EXISTS entity_tag (
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  basis TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 1 CHECK (confirmations > 0),
  PRIMARY KEY (entity_type, entity_id, tag_id, source)
);

CREATE TABLE IF NOT EXISTS provider_mapping (
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  provider_parent_id TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 1 CHECK (confirmations > 0),
  UNIQUE (entity_type, entity_id, provider, provider_id)
);

CREATE INDEX IF NOT EXISTS provider_mapping_lookup
  ON provider_mapping(provider, provider_id, entity_type);
CREATE UNIQUE INDEX IF NOT EXISTS provider_mapping_recording_identity
  ON provider_mapping(provider, provider_id) WHERE entity_type = 'recording';

CREATE TABLE IF NOT EXISTS mapping_evidence (
  mapping_id INTEGER NOT NULL REFERENCES provider_mapping(id) ON DELETE CASCADE,
  evidence_key TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (mapping_id, evidence_key)
);

CREATE TABLE IF NOT EXISTS rating (
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id, source)
);

CREATE TABLE IF NOT EXISTS user_event (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '',
  entity_id INTEGER,
  recording_id INTEGER REFERENCES recording(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT '',
  provider_track_id TEXT NOT NULL DEFAULT '',
  position_ms INTEGER,
  duration_ms INTEGER,
  played_ms INTEGER,
  created_at TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS user_event_recording
  ON user_event(recording_id, created_at);
CREATE INDEX IF NOT EXISTS user_event_provider
  ON user_event(provider, provider_track_id);
CREATE INDEX IF NOT EXISTS user_event_created
  ON user_event(created_at);

CREATE TABLE IF NOT EXISTS external_cache (
  key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  route TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  last_used_at TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS external_cache_expiry
  ON external_cache(expires_at);

CREATE TABLE IF NOT EXISTS cache_stats (
  provider TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  writes INTEGER NOT NULL DEFAULT 0,
  evictions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
`,
  },
];

module.exports = { SCHEMA_VERSION, migrations };
