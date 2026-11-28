'use strict';

const { setTimeout: sleep } = require('node:timers/promises');

const MB = 'https://musicbrainz.org/ws/2';
const LB = 'https://api.listenbrainz.org/1';
const USER_AGENT = 'OrbitaAlpha/2.0 (https://github.com/epigenezis-boop/orbita-releases)';
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class DiscoveryError extends Error {
  constructor(code, provider = '') {
    super(provider ? provider + ':' + code : code);
    this.code = code;
    this.provider = provider;
  }
}

async function readJson(response) {
  if (!response.body) throw new Error('Missing body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0;
  let text = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return JSON.parse(text + decoder.decode());
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Oversized body');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function retryDelay(headers) {
  const retryAfter = headers.get('retry-after');
  const resetIn = headers.get('x-ratelimit-reset-in');
  if (retryAfter && /^\d+$/.test(retryAfter)) return Number(retryAfter) * 1000;
  if (retryAfter && Number.isFinite(Date.parse(retryAfter))) return Math.max(0, Date.parse(retryAfter) - Date.now());
  if (resetIn && /^\d+$/.test(resetIn)) return Number(resetIn) * 1000;
  return 60_000;
}

class ReadOnlyProvider {
  constructor(name, base, fetch, interval, cacheAge) {
    Object.assign(this, { name, base, fetch, interval, cacheAge });
    this.cache = new Map();
    this.tail = Promise.resolve();
    this.nextRequest = 0;
    this.blockedUntil = 0;
  }

  get(route, params, { signal, token, cache = true } = {}) {
    const url = new URL(this.base + route);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const job = this.tail.then(async () => {
      signal?.throwIfAborted();
      const hit = this.cache.get(url.href);
      if (cache && hit && hit.expires > Date.now()) {
        this.cache.delete(url.href);
        this.cache.set(url.href, hit);
        return hit.value;
      }
      if (this.blockedUntil > Date.now()) throw new DiscoveryError('rate-limited', this.name);
      const wait = this.nextRequest - Date.now();
      if (wait > 0) await sleep(wait, undefined, { signal });
      this.nextRequest = Date.now() + this.interval;
      let value;
      try {
        value = await this.request(url, token, signal);
      } catch (error) {
        if (this.name !== 'musicbrainz' || !['network', 'unavailable'].includes(error.code)) throw error;
        const delay = Math.max(this.nextRequest, this.blockedUntil) - Date.now();
        if (delay > 5000) throw error;
        if (delay > 0) await sleep(delay, undefined, { signal });
        this.nextRequest = Date.now() + this.interval;
        value = await this.request(url, token, signal);
      }
      if (cache) {
        this.cache.set(url.href, { value, expires: Date.now() + this.cacheAge });
        if (this.cache.size > 512) this.cache.delete(this.cache.keys().next().value);
      }
      return value;
    });
    this.tail = job.catch(() => {});
    return job;
  }

  async request(url, token, signal) {
    const timeout = AbortSignal.timeout(12_000);
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
    if (token) headers.Authorization = 'Token ' + token;
    let response;
    try {
      response = await this.fetch(url.href, {
        method: 'GET', headers, credentials: 'omit', redirect: 'error', signal: requestSignal,
      });
      if (response.status === 204 || response.status === 404) return null;
      if (!response.ok) {
        const status = response.status;
        if (status === 429) {
          this.blockedUntil = Date.now() + Math.max(1000, retryDelay(response.headers));
          throw new DiscoveryError('rate-limited', this.name);
        }
        if (status === 401 || status === 403) throw new DiscoveryError('denied', this.name);
        if (status === 503 && this.name === 'musicbrainz') {
          this.blockedUntil = Date.now() + (response.headers.has('retry-after') ? retryDelay(response.headers) : 3500);
        }
        throw new DiscoveryError(status >= 500 ? 'unavailable' : 'request-rejected', this.name);
      }
      if (response.headers.get('x-ratelimit-remaining') === '0') {
        this.blockedUntil = Date.now() + Math.max(1000, retryDelay(response.headers));
      }
      if (!/^application\/(?:[\w.+-]*\+)?json\b/i.test(response.headers.get('content-type') || '')) {
        throw new DiscoveryError('invalid-response', this.name);
      }
      return await readJson(response);
    } catch (error) {
      signal?.throwIfAborted();
      if (timeout.aborted) throw new DiscoveryError('timeout', this.name);
      if (error instanceof DiscoveryError) throw error;
      throw new DiscoveryError(response ? 'invalid-response' : 'network', this.name);
    } finally {
      if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
    }
  }
}

function createProviders(fetch) {
  const music = new ReadOnlyProvider('musicbrainz', MB, fetch, 1100, 12 * 60 * 60_000);
  const listen = new ReadOnlyProvider('listenbrainz', LB, fetch, 350, 30 * 60_000);
  return {
    music: {
      artist(name, signal) {
        const escaped = name.replace(/[+\-!(){}\[\]^"~*?:\\/|&]/g, '\\$&');
        return music.get('/artist', { query: 'artist:"' + escaped + '"', fmt: 'json', limit: '50' }, { signal });
      },
      artistById(id, signal) {
        return music.get('/artist/' + id, { fmt: 'json' }, { signal });
      },
      recording(id, signal) {
        return music.get('/recording/' + id, {
          fmt: 'json', inc: 'artist-credits+releases+release-groups+isrcs',
        }, { signal });
      },
    },
    listen: {
      radio(id, mode, token, signal) {
        return listen.get('/lb-radio/artist/' + id, {
          mode, max_similar_artists: '12', max_recordings_per_artist: '3', pop_begin: '0', pop_end: '100',
        }, { token, signal, cache: !token });
      },
      async validate(token, signal) {
        const body = await listen.get('/validate-token', {}, { token, signal, cache: false });
        if (typeof body?.valid !== 'boolean') throw new DiscoveryError('invalid-response', 'listenbrainz');
        return body.valid;
      },
    },
  };
}

module.exports = { createProviders, DiscoveryError };
