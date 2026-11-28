'use strict';

const { DiscoveryError } = require('./providers.cjs');
const { mbid, text, artist, resolveArtists, radioCandidates, recording, matchRecording } = require('./model.cjs');

class Discovery {
  constructor({ providers, storage, searchZvuk, connected, progress }) {
    Object.assign(this, { providers, storage, searchZvuk, connected, progress });
    this.artistOptions = new Set();
    this.matchCache = new Map();
    this.job = null;
    this.report = null;
    this.credentialBusy = false;
    this.catalogRevision = 0;
  }

  cancel() {
    if (!this.job) return;
    this.job.abort(new DiscoveryError('cancelled'));
    this.job = null;
  }

  accountChanged() {
    this.catalogRevision++;
    this.matchCache.clear();
    // Catalog mappings remain read-only in the report, but they cannot be used
    // to play against a newly connected account until rerun against that account.
  }

  start(operation) {
    this.cancel();
    const job = new AbortController();
    this.job = job;
    return operation(job.signal).finally(() => {
      if (this.job === job) this.job = null;
    });
  }

  identify(names) {
    if (!Array.isArray(names) || names.length < 1 || names.length > 4 ||
        names.some((name) => typeof name !== 'string' || name.trim().length < 2 || name.length > 120)) {
      throw new DiscoveryError('invalid-seeds');
    }
    this.artistOptions.clear();
    return this.start(async (signal) => {
      const result = [];
      for (const input of names) {
        const query = input.trim();
        const id = mbid(query);
        try {
          const options = id
            ? [artist(await this.providers.music.artistById(id, signal))].filter(Boolean)
            : resolveArtists(await this.providers.music.artist(query, signal), query);
          signal.throwIfAborted();
          result.push({ query, options });
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof DiscoveryError)) throw error;
          result.push({ query, options: [], error: error.message });
        }
      }
      this.artistOptions = new Set(result.flatMap(({ options }) => options.map(({ id }) => id)));
      return result;
    });
  }

  recommend(seedIds, mode, count) {
    if (!Array.isArray(seedIds) || seedIds.length < 1 || seedIds.length > 4 ||
        new Set(seedIds).size !== seedIds.length || seedIds.some((id) => typeof id !== 'string' || !this.artistOptions.has(id)) ||
        !['easy', 'medium', 'hard'].includes(mode) || ![10, 20, 30].includes(count)) {
      throw new DiscoveryError('invalid-seeds');
    }
    this.report = null;
    return this.start(async (signal) => {
      this.progress({ stage: 'radio' });
      const responses = [];
      const notices = new Set();
      for (const seed of seedIds) {
        try {
          responses.push({ seed, data: await this.radio(seed, mode, signal) });
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof DiscoveryError) || responses.length === 0) throw error;
          notices.add(error.message);
        }
      }
      const candidates = radioCandidates(responses, seedIds, count);
      const candidatesWithMetadata = [];
      let consecutiveMetadataFailures = 0;
      let stopMetadata = false;
      let matchingFailure;
      const catalogRevision = this.catalogRevision;
      let feedback = {};
      try { feedback = this.storage.readVotes(); }
      catch (error) { notices.add(error.message); }

      for (const [index, candidate] of candidates.entries()) {
        signal.throwIfAborted();
        this.progress({ stage: 'details', done: index, total: candidates.length });
        let metadata = null;
        if (!stopMetadata) {
          try {
            const raw = await this.providers.music.recording(candidate.id, signal);
            metadata = recording(raw, candidate);
            consecutiveMetadataFailures = 0;
          } catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof DiscoveryError)) throw error;
            notices.add(error.message);
            consecutiveMetadataFailures++;
            stopMetadata = error.code === 'rate-limited' || consecutiveMetadataFailures >= 2;
          }
        }
        let match = { status: metadata ? 'connect-zvuk' : 'metadata-unavailable', options: [] };
        if (metadata && this.connected() && this.catalogRevision === catalogRevision) {
          if (!matchingFailure) {
            try {
              match = await this.match(metadata, signal);
            } catch (error) {
              signal.throwIfAborted();
              matchingFailure = this.zvukFailure(error);
              notices.add(matchingFailure);
            }
          }
          if (matchingFailure) match = { status: 'catalog-unavailable', options: [] };
        }
        candidatesWithMetadata.push({ ...candidate, recording: metadata, match, feedback: feedback[candidate.id] || null });
      }

      signal.throwIfAborted();
      this.report = {
        schema: 1, generatedAt: new Date().toISOString(), seedIds, mode, requested: count,
        source: 'listenbrainz-radio', metadataSource: 'musicbrainz', artworkSource: 'zvuk',
        notices: [...notices], candidates: candidatesWithMetadata,
        catalogRevision,
      };
      return this.report;
    });
  }

  async radio(seed, mode, signal) {
    try {
      return await this.providers.listen.radio(seed, mode, null, signal);
    } catch (error) {
      if (error.code !== 'denied') throw error;
      const token = this.storage.readToken();
      if (!token) throw new DiscoveryError('token-required', 'listenbrainz');
      return this.providers.listen.radio(seed, mode, token, signal);
    }
  }

  async match(metadata, signal) {
    const key = metadata.id;
    const cached = this.matchCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.match;
    const revision = this.catalogRevision;
    const query = (metadata.title.slice(0, 105) + ' ' + metadata.artistCredit.slice(0, 90)).trim();
    const results = await this.searchZvuk(query, signal);
    signal.throwIfAborted();
    if (revision !== this.catalogRevision) return { status: 'connect-zvuk', options: [] };
    const match = matchRecording(metadata, results);
    this.matchCache.set(key, { match, expires: Date.now() + 20 * 60_000 });
    if (this.matchCache.size > 256) this.matchCache.delete(this.matchCache.keys().next().value);
    return match;
  }

  zvukFailure(error) {
    const code = /^\[(API_HTML|API_RATE_LIMIT(?:\/\w+)?|HTTP_429|AUTH_\w+|HTTP_40[13]|NETWORK_TIMEOUT)\]/.exec(error.message)?.[1];
    if (code === 'API_HTML') return 'zvuk:verification';
    if (code?.startsWith('API_RATE_LIMIT') || code === 'HTTP_429') return 'zvuk:rate-limited';
    if (code?.startsWith('AUTH_') || code === 'HTTP_401' || code === 'HTTP_403') return 'zvuk:denied';
    if (code === 'NETWORK_TIMEOUT') return 'zvuk:timeout';
    return 'zvuk:unavailable';
  }

  async credential(action, value) {
    if (action === 'info') {
      const info = this.storage.credentialInfo();
      return { ...info, status: info.secure ? (info.configured ? 'saved' : 'unset') : 'secure-storage-unavailable' };
    }
    if (this.credentialBusy) throw new DiscoveryError('credential-busy');
    this.credentialBusy = true;
    try {
      if (action === 'remove') {
        this.storage.forgetToken();
        return this.credential('info');
      }
      const replacing = action === 'save';
      const token = replacing ? (typeof value === 'string' ? value.trim() : '') : this.storage.readToken();
      if (replacing && !this.storage.credentialInfo().secure) throw new DiscoveryError('secure-storage-unavailable');
      if (!token && !replacing) return this.credential('info');
      if (!/^[A-Za-z0-9_-]{10,128}$/.test(token)) throw new DiscoveryError('invalid-token', 'listenbrainz');
      if (!await this.providers.listen.validate(token)) throw new DiscoveryError('invalid-token', 'listenbrainz');
      if (replacing) this.storage.saveToken(token);
      return { configured: true, secure: true, status: 'connected' };
    } finally {
      this.credentialBusy = false;
    }
  }

  saveFeedback(id, vote) {
    const entry = this.report?.candidates.find((candidate) => candidate.id === mbid(id));
    if (!entry || ![null, 'like', 'dislike'].includes(vote)) throw new DiscoveryError('invalid-feedback');
    this.storage.vote(entry.id, vote);
    entry.feedback = vote;
    return vote;
  }

  choose(id, trackId) {
    const entry = this.report?.candidates.find((candidate) => candidate.id === mbid(id));
    if (!entry || !this.connected() || this.report.catalogRevision !== this.catalogRevision) {
      throw new DiscoveryError('zvuk:denied');
    }
    if (entry.match.status === 'matched' && entry.match.choice.track.id === trackId) return entry.match.choice.track;
    const selected = entry.match.options.find(({ track }) => track.id === trackId);
    if (!selected) throw new DiscoveryError('invalid-track');
    entry.match = {
      status: 'matched', choice: { ...selected, confidence: 'confirmed' }, options: [],
    };
    return selected.track;
  }

  exportReport() {
    if (!this.report) throw new DiscoveryError('no-report');
    const { schema, generatedAt, seedIds, mode, requested, source, metadataSource, artworkSource, notices, candidates } = this.report;
    function publicMatch(entry) {
      const { id, title, artist, album, albumId, duration } = entry.track;
      return { track: { id, title: text(title), artist: text(artist), album: text(album), albumId, duration },
        reasons: entry.reasons, confidence: entry.confidence };
    }
    return {
      schema, generatedAt, seedIds, mode, requested, source, metadataSource, artworkSource, notices,
      candidates: candidates.map(({ id, artistId, artistName, seedArtistIds, listenCount, recording, match, feedback }) => ({
        id, artistId, artistName, seedArtistIds, listenCount, recording, feedback,
        match: { status: match.status, choice: match.choice ? publicMatch(match.choice) : null,
          options: match.options.map(publicMatch) },
      })),
    };
  }
}

module.exports = { Discovery };
