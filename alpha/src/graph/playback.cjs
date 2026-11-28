'use strict';

// Derives factual playback events from the existing player-state IPC stream.
// Seeking, buffering, playback errors and app shutdown are deliberately not
// treated as negative feedback. No event is emitted when the app closes.
function createPlaybackTracker(emit) {
  let current = null;
  let session = 0;
  let closed = false;
  const send = (type, state, extra = {}) => {
    if (typeof emit !== 'function') return;
    try {
      emit({
        type,
        trackId: state.id,
        title: state.title,
        artist: state.artist,
        provider: state.id.startsWith('local-') ? 'local' : 'zvuk',
        ...extra,
      });
    } catch { /* storage failures must not affect playback */ }
  };

  function finish(reason) {
    if (!current) return;
    if (!current.closed && !current.completed && current.started && current.listened >= 3) {
      const duration = current.duration;
      const early = duration > 0 ? current.maxTime < duration * 0.85 : false;
      if (early) {
        send('skip', current, {
          positionMs: Math.round(current.maxTime * 1000),
          durationMs: duration > 0 ? Math.round(duration * 1000) : null,
          playedMs: Math.round(current.listened * 1000),
          dedupeKey: `skip:${current.id}:${current.session}`,
          detail: { reason },
        });
      }
    }
    current.closed = true;
  }

  return {
    update(state) {
      if (closed || !state || typeof state !== 'object') return;
      const id = String(state.trackId || '');
      if (!id) return;
      const paused = Boolean(state.paused);
      const time = finite(state.time);
      const duration = finite(state.duration);
      if (!current || current.id !== id) {
        finish('track-change');
        current = {
          id, title: typeof state.title === 'string' ? state.title : '',
          artist: typeof state.artist === 'string' ? state.artist : '',
          session: ++session, started: !paused,
          maxTime: time, duration, lastTime: time, listened: 0, completed: false, closed: false,
        };
        if (!paused) {
          send('play', current, {
            positionMs: Math.round(time * 1000),
            durationMs: duration > 0 ? Math.round(duration * 1000) : null,
            playedMs: 0,
            dedupeKey: `play:${id}:${current.session}`,
          });
        }
        return;
      }

      // A completed track that the user starts again from the beginning is a replay.
      // A media element resetting currentTime while paused after `ended` is not.
      if (!paused && current.completed && time + 2 < current.maxTime && time < 2) {
        current = {
          id, title: current.title, artist: current.artist,
          session: ++session, started: !paused, maxTime: time, duration,
          lastTime: time, listened: 0, completed: false, closed: false,
        };
        send('replay', current, {
          positionMs: 0,
          durationMs: duration > 0 ? Math.round(duration * 1000) : null,
          playedMs: 0,
          dedupeKey: `replay:${id}:${current.session}`,
        });
        if (!paused) {
          send('play', current, {
            positionMs: 0,
            durationMs: duration > 0 ? Math.round(duration * 1000) : null,
            playedMs: 0,
            dedupeKey: `play:${id}:${current.session}`,
          });
        }
        return;
      }

      const delta = time - current.lastTime;
      if (!paused && delta > 0 && delta <= 2.5) current.listened += delta;
      current.maxTime = Math.max(current.maxTime, time);
      current.lastTime = time;
      if (duration > 0) current.duration = duration;
      if (!paused && !current.started) {
        current.started = true;
        send('play', current, {
          positionMs: Math.round(time * 1000),
          durationMs: current.duration > 0 ? Math.round(current.duration * 1000) : null,
          playedMs: 0,
          dedupeKey: `play:${id}:${current.session}`,
        });
      }
      if (current.duration > 0 && time >= current.duration - 1.5 && !current.completed) {
        current.completed = true;
        // Reaching the end after seeking across most of the track is not a listened completion.
        const genuine = current.listened >= current.duration * 0.8 ||
          (current.duration <= 10 && current.listened >= current.duration * 0.5);
        if (genuine) {
          send('complete', current, {
            positionMs: Math.round(time * 1000),
            durationMs: Math.round(current.duration * 1000),
            playedMs: Math.round(current.listened * 1000),
            dedupeKey: `complete:${id}:${current.session}`,
          });
        }
      }    },
    stop() {
      closed = true;
      current = null;
    },
    get current() {
      return current ? { ...current } : null;
    },
  };
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

module.exports = { createPlaybackTracker };
