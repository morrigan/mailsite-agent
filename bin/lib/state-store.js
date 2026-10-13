'use strict';
// Local state store, a stand-in for provider-side mail labels, used by read
// providers that have no server labels (currently: resend inbound mode).
//
// Persists to <hub>/logs/mail-state.json as { "<msgId>": { state, updated } }.
// The agent run is single-instance (the cron lock), so writes don't race.

const fs = require('fs');
const path = require('path');

function storePath(hubRoot) { return path.join(hubRoot, 'logs', 'mail-state.json'); }

function load(hubRoot) {
  const f = storePath(hubRoot);
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; }
}

function save(hubRoot, data) {
  const f = storePath(hubRoot);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
}

function getState(hubRoot, msgId) {
  const rec = load(hubRoot)[msgId];
  return rec ? rec.state : null;
}

function setState(hubRoot, msgId, state) {
  const data = load(hubRoot);
  data[msgId] = { state, updated: new Date().toISOString() };
  save(hubRoot, data);
  return data[msgId];
}

/** All msgIds currently in a given state. */
function withState(hubRoot, state) {
  const data = load(hubRoot);
  return Object.keys(data).filter((id) => data[id].state === state);
}

module.exports = { getState, setState, withState, load };
