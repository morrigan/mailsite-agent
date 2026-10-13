'use strict';
// Resend provider — full read + send.
//
// Sending: Resend's transactional API (dependency-free). Drop-in as `mail.send`.
//   Env: RESEND_API_KEY   Config: cfg.resend.from (verified sender)
//
// Reading ("Resend inbound mode"): Resend delivers inbound as a live NDJSON
// stream (`resend emails receiving listen`) and has no server-side labels. So
// reading is backed by two local pieces instead:
//   1. a local maildir  <hub>/logs/resend-inbox/<id>.json  populated by the
//      long-running listener  bin/mailsite-resend-listener;
//   2. a local state store (bin/lib/state-store) standing in for mail labels.
// Attachment bytes are fetched on demand via `resend emails receiving get`.
//
// NOTE: the exact inbound JSON field names aren't pinned in Resend's public
// docs, so field extraction below is deliberately defensive — adjust the
// `normalize()` aliases if your real payloads differ.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { die, reSubject } = require('../common');
const store = require('../state-store');

function hub(cfg) { return cfg._hubRoot || process.env.MAILSITE_HUB || process.cwd(); }
function inboxDir(cfg) { return path.join(hub(cfg), 'logs', 'resend-inbox'); }

function readInbox(cfg) {
  const dir = inboxDir(cfg);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } })
    .filter(Boolean);
}

function headerLookup(raw) {
  const hs = raw.headers;
  return (name) => {
    if (!hs) return undefined;
    if (Array.isArray(hs)) {
      const hit = hs.find((x) => x.name && x.name.toLowerCase() === name.toLowerCase());
      return hit && hit.value;
    }
    return hs[name] || hs[name.toLowerCase()];
  };
}

/** Map a raw Resend inbound object into the port's standard message shape. */
function normalize(raw) {
  const h = headerLookup(raw);
  const id = raw.id || raw.email_id || raw.message_id || raw.messageId;
  const from = raw.from || (raw.envelope && raw.envelope.from) || '';
  const to = Array.isArray(raw.to) ? raw.to.join(', ') : (raw.to || '');
  const subject = raw.subject || '';
  const body = raw.text || raw.body || raw.html || '';
  const messageIdHeader = raw.message_id || (h && h('Message-ID')) || String(id);
  const references = raw.references || (h && (h('References') || h('In-Reply-To'))) || '';
  const date = raw.created_at || raw.date || '';
  const internalDate = date ? String(Date.parse(date) || '') : '';
  const attachments = (raw.attachments || []).map((a, i) => ({
    filename: a.filename || a.name || `attachment-${i}`,
    mimeType: a.content_type || a.contentType || a.type || 'application/octet-stream',
    attachmentId: String(a.id != null ? a.id : i),
    content: a.content || a.content_base64 || null,
  }));
  return { msgId: String(id), threadId: references || messageIdHeader || String(id), from, to, subject, body, messageIdHeader, references, internalDate, attachments };
}

function findRaw(cfg, msgId) {
  const raw = readInbox(cfg).find((r) => String(r.id || r.email_id || r.message_id || r.messageId) === String(msgId));
  if (!raw) die(`Resend inbox has no message ${msgId} (is bin/mailsite-resend-listener running?)`);
  return raw;
}

/** Fetch a message via the Resend CLI (for attachment bytes not in the maildir). */
function cliGet(msgId) {
  try {
    const out = execFileSync('resend', ['emails', 'receiving', 'get', String(msgId), '--json'], { encoding: 'utf8' });
    return JSON.parse(out);
  } catch (e) {
    die(`"resend emails receiving get ${msgId}" failed (is the resend CLI installed and RESEND_API_KEY set?): ${e.message}`);
  }
}

module.exports = {
  canRead: true,
  canSend: true,

  async fetchNew(cfg, { label } = {}) {
    const hubRoot = hub(cfg);
    const msgs = readInbox(cfg).map(normalize);
    const selected = label
      ? msgs.filter((m) => new Set(store.withState(hubRoot, label)).has(m.msgId))
      : msgs.filter((m) => !store.getState(hubRoot, m.msgId));
    return selected.map((m) => ({ msgId: m.msgId, threadId: m.threadId, from: m.from, subject: m.subject }));
  },

  async get(cfg, msgId) {
    const m = normalize(findRaw(cfg, msgId));
    // Don't leak inline base64 in `get`; attachments are fetched by download.
    return { ...m, attachments: m.attachments.map(({ content, ...meta }) => meta) };
  },

  async downloadAttachments(cfg, msgId, destDir) {
    let atts = normalize(findRaw(cfg, msgId)).attachments;
    if (atts.length && !atts.some((a) => a.content)) {
      // No inline bytes in the maildir — pull full content via the CLI.
      atts = normalize(cliGet(msgId)).attachments;
    }
    fs.mkdirSync(destDir, { recursive: true });
    const written = [];
    atts.forEach((a, i) => {
      if (!a.content) return;
      const safe = path.basename(a.filename || `attachment-${i}`).replace(/[^\w.\-]/g, '_');
      const dest = path.join(destDir, safe);
      fs.writeFileSync(dest, Buffer.from(a.content, 'base64'));
      written.push({ filename: safe, mimeType: a.mimeType, path: dest, bytes: fs.statSync(dest).size });
    });
    return { msgId, destDir, written };
  },

  async label(cfg, msgId, state) {
    store.setState(hub(cfg), msgId, state);
    return { msgId, state };
  },

  async threadReplies(cfg, msgId, sinceIso) {
    const orig = normalize(findRaw(cfg, msgId));
    const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
    const needle = orig.messageIdHeader;
    const replies = readInbox(cfg).map(normalize)
      .filter((m) => m.msgId !== orig.msgId && needle && String(m.references).includes(needle))
      .filter((m) => Number(m.internalDate || 0) > sinceMs)
      .map((m) => ({ msgId: m.msgId, from: m.from, date: m.internalDate, internalDate: m.internalDate, body: m.body }));
    return { threadId: orig.threadId, replies };
  },

  // `msg` = {to, subject, inReplyTo, references, threadId, body}
  async send(cfg, msg) {
    const key = process.env.RESEND_API_KEY;
    if (!key) die('Resend send needs RESEND_API_KEY in .env');
    const from = (cfg.resend && cfg.resend.from) || cfg.updateAddress;
    if (!from) die('Resend send needs cfg.resend.from (a verified sender address)');
    const headers = {};
    if (msg.inReplyTo) headers['In-Reply-To'] = msg.inReplyTo;
    if (msg.references) headers['References'] = msg.references;
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [msg.to], subject: reSubject(msg.subject), text: msg.body, headers }),
    });
    if (!res.ok) die(`Resend API → ${res.status} ${await res.text()}`);
    const data = await res.json();
    return { sentId: data.id };
  },
};
