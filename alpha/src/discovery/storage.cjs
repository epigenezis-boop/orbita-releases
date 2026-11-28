'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { mbid } = require('./model.cjs');
const { DiscoveryError } = require('./providers.cjs');

function atomicWrite(file, contents) {
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temp, contents, { flag: 'wx', mode: 0o600 });
    fs.renameSync(temp, file);
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function createStorage(profile, safeStorage) {
  const vault = path.join(profile, 'discovery-credential.bin');
  const feedback = path.join(profile, 'discovery-feedback.json');
  const encrypted = () => safeStorage.isEncryptionAvailable() &&
    safeStorage.getSelectedStorageBackend?.() !== 'basic_text';

  function readVotes() {
    try {
      const saved = JSON.parse(fs.readFileSync(feedback, 'utf8'));
      if (saved?.schema !== 1 || !saved.votes || typeof saved.votes !== 'object') {
        throw new Error('Invalid feedback file');
      }
      return Object.fromEntries(Object.entries(saved.votes).filter(([id, vote]) =>
        mbid(id) && ['like', 'dislike'].includes(vote)));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw new DiscoveryError('feedback-storage');
    }
  }

  return {
    credentialInfo: () => ({ configured: fs.existsSync(vault), secure: encrypted() }),
    readToken() {
      if (!fs.existsSync(vault)) return null;
      if (!encrypted()) throw new DiscoveryError('secure-storage-unavailable');
      try {
        const token = safeStorage.decryptString(fs.readFileSync(vault));
        if (!/^[A-Za-z0-9_-]{10,128}$/.test(token)) throw new Error('Invalid credential');
        return token;
      } catch {
        throw new DiscoveryError('credential-storage');
      }
    },
    saveToken(token) {
      if (!encrypted()) throw new DiscoveryError('secure-storage-unavailable');
      try {
        atomicWrite(vault, safeStorage.encryptString(token));
      } catch {
        throw new DiscoveryError('credential-storage');
      }
    },
    forgetToken() {
      try { fs.rmSync(vault, { force: true }); }
      catch { throw new DiscoveryError('credential-storage'); }
    },
    readVotes,
    vote(id, vote) {
      const votes = readVotes();
      if (vote) votes[id] = vote;
      else delete votes[id];
      try { atomicWrite(feedback, JSON.stringify({ schema: 1, votes }) + '\n'); }
      catch { throw new DiscoveryError('feedback-storage'); }
    },
  };
}

module.exports = { createStorage };
