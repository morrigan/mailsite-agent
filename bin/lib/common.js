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

module.exports = {
  STATES, die, out, b64urlDecode, b64urlEncode,
  loadEnv, loadConfig, parseFlags, reSubject,
};
