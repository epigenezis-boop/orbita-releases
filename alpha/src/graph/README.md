# Music Graph 0.1 — module contract

This directory owns Orbita's local music knowledge base. It is loaded only in the
Electron main process. Renderers see aggregate statistics through IPC, never the
database itself.

## Files and owners

| File | Responsibility |
| --- | --- |
| `schema.cjs` | Schema version and forward-only migrations. |
| `database.cjs` | `node:sqlite` open/close, WAL, foreign keys, transactions, integrity checks, corruption isolation, size, cache storage. |
| `repository.cjs` | Musical entities, relations, ratings, user events, recommendation ingestion. |
| `index.cjs` | Facade used by `main.cjs` and Discovery: cache adapter, legacy feedback import, statistics. |

`node:sqlite` ships with Electron 45 (Node 24.22.1). The local Node.js 22 toolchain
also provides it, so Node tests exercise the same driver. No native dependency is
added.

## Database location

`%APPDATA%\orbita-player-alpha\music-graph.sqlite` (the isolated Alpha profile).
The stable profile `%APPDATA%\volna-player` is never touched.

## Schema v1

Timestamps are ISO-8601 UTC strings. Internal entity identifiers are SQLite
`INTEGER PRIMARY KEY` values and remain stable. MBIDs are optional (`UNIQUE`
columns allow several `NULL` values).

```sql
schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)
graph_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)

artist(
  id INTEGER PRIMARY KEY, mbid TEXT UNIQUE, name TEXT NOT NULL,
  name_key TEXT NOT NULL, disambiguation TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '', begin_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (mbid IS NULL OR length(mbid) = 36)
);
CREATE UNIQUE INDEX artist_local_identity ON artist(name_key, disambiguation)
  WHERE mbid IS NULL;

recording(
  id INTEGER PRIMARY KEY, mbid TEXT UNIQUE, title TEXT NOT NULL,
  title_key TEXT NOT NULL, disambiguation TEXT NOT NULL DEFAULT '',
  duration_ms INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (mbid IS NULL OR length(mbid) = 36),
  CHECK (duration_ms IS NULL OR duration_ms > 0)
);
CREATE UNIQUE INDEX recording_local_identity ON recording(title_key, disambiguation)
  WHERE mbid IS NULL;

recording_isrc(isrc TEXT PRIMARY KEY, recording_id INTEGER NOT NULL
  REFERENCES recording(id) ON DELETE CASCADE);

release_group(
  id INTEGER PRIMARY KEY, mbid TEXT UNIQUE, title TEXT NOT NULL,
  title_key TEXT NOT NULL, primary_type TEXT NOT NULL DEFAULT '',
  secondary_types TEXT NOT NULL DEFAULT '[]', first_release_date TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (mbid IS NULL OR length(mbid) = 36)
);
CREATE UNIQUE INDEX release_group_local_identity ON release_group(title_key, primary_type)
  WHERE mbid IS NULL;

release(
  id INTEGER PRIMARY KEY, mbid TEXT UNIQUE,
  release_group_id INTEGER REFERENCES release_group(id) ON DELETE SET NULL,
  title TEXT NOT NULL, title_key TEXT NOT NULL, date TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (mbid IS NULL OR length(mbid) = 36)
);
CREATE UNIQUE INDEX release_local_identity ON release(title_key, date, release_group_id)
  WHERE mbid IS NULL;

release_track(
  id INTEGER PRIMARY KEY,
  release_id INTEGER NOT NULL REFERENCES release(id) ON DELETE CASCADE,
  recording_id INTEGER NOT NULL REFERENCES recording(id) ON DELETE CASCADE,
  medium_position INTEGER, track_position INTEGER,
  title TEXT NOT NULL DEFAULT '', duration_ms INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  CHECK (medium_position IS NULL OR medium_position > 0),
  CHECK (track_position IS NULL OR track_position > 0),
  CHECK (duration_ms IS NULL OR duration_ms > 0),
  UNIQUE (release_id, medium_position, track_position)
);

tag(id INTEGER PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE);

relation(
  id INTEGER PRIMARY KEY,
  subject_type TEXT NOT NULL, subject_id INTEGER NOT NULL,
  predicate TEXT NOT NULL,
  object_type TEXT NOT NULL, object_id INTEGER NOT NULL,
  source TEXT NOT NULL, basis TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL, last_confirmed_at TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 1 CHECK (confirmations > 0),
  UNIQUE (subject_type, subject_id, predicate, object_type, object_id, source)
);
CREATE INDEX relation_subject ON relation(subject_type, subject_id, predicate);
CREATE INDEX relation_object ON relation(object_type, object_id, predicate);

relation_evidence(
  relation_id INTEGER NOT NULL REFERENCES relation(id) ON DELETE CASCADE,
  evidence_key TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY (relation_id, evidence_key)
);

entity_tag(
  entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  tag_id INTEGER NOT NULL REFERENCES tag(id) ON DELETE CASCADE,
  source TEXT NOT NULL, basis TEXT NOT NULL DEFAULT '',
  confidence TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
  last_confirmed_at TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 1 CHECK (confirmations > 0),
  PRIMARY KEY (entity_type, entity_id, tag_id, source)
);

provider_mapping(
  id INTEGER PRIMARY KEY,
  entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  provider TEXT NOT NULL, provider_id TEXT NOT NULL,
  provider_parent_id TEXT NOT NULL DEFAULT '',
  basis TEXT NOT NULL DEFAULT '', confidence TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, last_confirmed_at TEXT NOT NULL,
  confirmations INTEGER NOT NULL DEFAULT 1 CHECK (confirmations > 0),
  UNIQUE (entity_type, entity_id, provider, provider_id)
);
CREATE INDEX provider_mapping_lookup
  ON provider_mapping(provider, provider_id, entity_type);
CREATE UNIQUE INDEX provider_mapping_recording_identity
  ON provider_mapping(provider, provider_id) WHERE entity_type = 'recording';

mapping_evidence(
  mapping_id INTEGER NOT NULL REFERENCES provider_mapping(id) ON DELETE CASCADE,
  evidence_key TEXT NOT NULL, observed_at TEXT NOT NULL,
  PRIMARY KEY (mapping_id, evidence_key)
);

rating(
  entity_type TEXT NOT NULL, entity_id INTEGER NOT NULL,
  source TEXT NOT NULL, value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id, source)
);

user_event(
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '', entity_id INTEGER,
  recording_id INTEGER REFERENCES recording(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT '', provider_track_id TEXT NOT NULL DEFAULT '',
  position_ms INTEGER, duration_ms INTEGER, played_ms INTEGER,
  created_at TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT UNIQUE
);
CREATE INDEX user_event_recording ON user_event(recording_id, created_at);
CREATE INDEX user_event_provider ON user_event(provider, provider_track_id);
CREATE INDEX user_event_created ON user_event(created_at);

external_cache(
  key TEXT PRIMARY KEY, provider TEXT NOT NULL, route TEXT NOT NULL DEFAULT '',
  scope TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL, created_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
  last_used_at TEXT NOT NULL, hits INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX external_cache_expiry ON external_cache(expires_at);

cache_stats(
  provider TEXT PRIMARY KEY,
  hits INTEGER NOT NULL DEFAULT 0, misses INTEGER NOT NULL DEFAULT 0,
  writes INTEGER NOT NULL DEFAULT 0, evictions INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
```

`PRAGMA user_version` mirrors `schema_migrations`. Migrations run inside
`BEGIN IMMEDIATE`; a copy of the database is made before a forward migration.
`journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`,
`busy_timeout=3000`. The WAL is checkpointed and the handle closed on quit.

Allowed `confidence` labels (no invented similarity coefficients):
`identifier`, `metadata`, `confirmed`, `reported`, `tagged`. For recommendation
links the label is `reported`; confirmations track the number of independent seed
artists that reported the link.

## Facade API (`index.cjs`)

```js
const graph = openMusicGraph({ profileDir, legacyFeedbackFile, diagnostics });
graph.available            // boolean
graph.error                // short stable code when unavailable
graph.cache                // adapter, see below
graph.rememberArtists(artists)          // artist objects from model.cjs
graph.recordReport(report, seedArtists) // report from Discovery.recommend
graph.recordVote(recordingMbid, vote)   // 'like' | 'dislike' | null
graph.recordChoice(recordingMbid, track)
graph.recordPlayback(event)             // derived main-process event
graph.recordFavorite(track, liked)
graph.stats()                           // aggregate counts, no rows
graph.clearCache()
graph.close()
```

Every facade method is defensive: a failed write is logged through `diagnostics`
and returns a result/`false`, never throws into the playback path. Discovery wraps
calls in `try/catch` as a second boundary.

## Cache adapter

```js
cache.get(provider, key, scope) -> payload | null
cache.put(provider, key, scope, payload, ttlMs, route)
cache.getSearch(scope, query) -> array | null     // Zvuk search, 6 h
cache.putSearch(scope, query, tracks)
cache.stats() -> { hits, misses, writes, evictions, entries }
cache.clear() -> removed rows
```

Only public ListenBrainz/MusicBrainz payloads and sanitized Zvuk catalog tracks
are cached. Tokens, cookies, authorization headers and stream URLs are never
passed to the adapter. The cache is a separate table: expiry or clearing never
deletes musical entities, relations or ratings.

Cache lifetimes follow the data source: MusicBrainz artist/recording responses
are kept for 14 days, ListenBrainz Radio for 6 hours, and Zvuk search results for
6 hours. The in-memory TTLs of the providers are unchanged (12 h / 30 min), so a
persistent hit behaves exactly like a fresh response. Entries are capped at 5 000
rows and 2 MiB per payload; expired rows are pruned every 25 writes. Token-bearing
requests use `cache:false` and are never written.

`provider_mapping` is also the durable record of confirmed Zvuk matches. A Zvuk
track identifier maps to exactly one recording; if a later, better match is
accepted, the mapping is re-pointed instead of duplicated, and playback events
that were stored before the mapping are backfilled with the recording id.

## Playback events

`playback.cjs` consumes the existing `player-state` stream. It records `play`,
`complete`, `skip` and `replay` with positions and a `played_ms` value accumulated
from real position deltas (forward jumps over 2.5 s are seeks and are not counted).
A completion requires at least 80% of a normal track to have actually played (50%
for tracks up to 10 s). Seeking to the end is not a listened completion. Closing
the app, pausing, buffering or a playback error emits no event. Likes and
favourites are stored separately as ratings and events.

## Known Alpha.2 limits

- MusicBrainz recording responses expose releases but not disc/track positions,
  so `release_track` rows are written only if a caller supplies verified
  `mediumPosition`/`trackPosition`. The `release contains recording` relation is
  stored instead; no positions are invented.
- Genres and tags are stored when MusicBrainz returns them. No extra enrichment
  requests are issued just to fill tags.
- Local music is represented by provider `local` events. Automatic matching of
  local files to MusicBrainz is deferred; the schema allows provider mappings for
  it.
- The graph is not visualised in Alpha.2. Only aggregate statistics are exposed.

## IPC (settings window only)

- `music-graph-stats` → `{ available, schemaVersion, file, dbSizeBytes,
  counts: { artists, recordings, releaseGroups, releases, releaseTracks, tags,
  relations, mappings, ratings, events }, cache: { hits, misses, writes,
  entries }, lastUpdated, recovered, error }`
- `music-graph-clear-cache` → `{ cleared, stats }`

The renderer cannot read rows, MBIDs, provider identifiers or file paths.
