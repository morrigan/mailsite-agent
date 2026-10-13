'use strict';
// Shared helpers for the mailsite-agent CLIs. No external dependencies.

const fs = require('fs');
const path = require('path');

const STATES = ['InProgress', 'AwaitingApproval', 'Published', 'Rejected', 'NeedsHuman'];

function die(msg, code = 1) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}
function out(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}
function b64urlDecode(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Minimal .env loader (no dependency). */
function loadEnv(hubRoot) {
  const f = path.join(hubRoot, '.env');
  if (!fs.existsSync(f)) return;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}

/** Load clients.json and normalize the mail provider config. */
function loadConfig(hubRoot) {
  const f = path.join(hubRoot, 'clients.json');
  if (!fs.existsSync(f)) die(`clients.json not found at ${f}`);
  const cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
  cfg.labelPrefix = cfg.labelPrefix || 'WebUpdate';
  // Record where the hub is so providers can reach logs/ (local state, inbox).
  Object.defineProperty(cfg, '_hubRoot', { value: hubRoot, enumerable: false });

  // Normalize mail config. Accept the modern `mail:{read,send}` object, or a
  // legacy flat `mailAdapter` string, and fill defaults.
  if (!cfg.mail) cfg.mail = {};
  if (cfg.mailAdapter && !cfg.mail.read) cfg.mail.read = cfg.mailAdapter;
  cfg.mail.read = cfg.mail.read || 'gmail';
  cfg.mail.send = cfg.mail.send || cfg.mail.read; // send defaults to the read provider
  return cfg;
}

function parseFlags(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else positional.push(args[i]);
  }
  return { flags, positional };
}

/** Normalize a Subject into a reply subject. */
function reSubject(subject) {
  const s = subject || '';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Poll `fn` until it reports done or the timeout elapses.
 * `fn` returns { done, value }. Returns the value when done, else null.
 */
async function pollUntil(fn, { timeoutSec = 300, intervalSec = 10 } = {}) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    const { done, value } = await fn();
    if (done) return value;
    await sleep(intervalSec * 1000);
  }
  return null;
}

/** Look up a client by id (or die). */
function getClient(cfg, id) {
  const c = (cfg.clients || []).find((x) => x.id === id);
  if (!c) die(`Unknown clientId: ${id}`);
  return c;
}

/**
 * Resolve a client's hosting config into a normalized shape, tolerating the
 * legacy flat `netlifySiteName`/`netlifySiteId` fields and a global default
 * provider (cfg.hosting.provider).
 */
function clientHosting(cfg, client) {
  const h = client.hosting || {};
  let provider = h.provider || (cfg.hosting && cfg.hosting.provider);
  if (!provider && (client.netlifySiteName || client.netlifySiteId)) provider = 'netlify';
  if (!provider) die(`Client "${client.id}" needs hosting.provider (netlify | cloudflare).`);
  return {
    provider,
    netlify: h.netlify || { siteName: client.netlifySiteName, siteId: client.netlifySiteId },
    cloudflare: h.cloudflare || {},
  };
}

module.exports = {
  STATES, die, out, b64urlDecode, b64urlEncode,
  loadEnv, loadConfig, parseFlags, reSubject,
  sleep, pollUntil, getClient, clientHosting,
};
