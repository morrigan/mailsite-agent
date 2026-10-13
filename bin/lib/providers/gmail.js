'use strict';
// Gmail provider — implements BOTH the read and send halves of the mail port
// using the Gmail REST API with an OAuth2 refresh token. No npm dependencies.
//
// Read half:  fetchNew, get, downloadAttachments, label, threadReplies
// Send half:  send
//
// Env: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN

const fs = require('fs');
const path = require('path');
const { STATES, die, b64urlDecode, b64urlEncode, reSubject } = require('../common');

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

async function token() {
  const { GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN } = process.env;
  if (!GMAIL_CLIENT_ID || !GMAIL_CLIENT_SECRET || !GMAIL_REFRESH_TOKEN) {
    die('Gmail provider needs GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN in .env');
  }
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: GMAIL_CLIENT_ID, client_secret: GMAIL_CLIENT_SECRET,
      refresh_token: GMAIL_REFRESH_TOKEN, grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) die(`OAuth token refresh failed: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

async function gapi(tok, p, opts = {}) {
  const res = await fetch(GMAIL + p, { ...opts, headers: { Authorization: `Bearer ${tok}`, ...(opts.headers || {}) } });
  if (!res.ok) die(`Gmail API ${p} → ${res.status} ${await res.text()}`);
  return res.json();
}

async function labelId(tok, prefix, state) {
  const name = `${prefix}/${state}`;
  const { labels = [] } = await gapi(tok, '/labels');
  const hit = labels.find((l) => l.name === name);
  if (hit) return hit.id;
  const created = await gapi(tok, '/labels', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }),
  });
  return created.id;
}

function headersOf(payload) {
  const h = {};
  for (const { name, value } of payload.headers || []) h[name.toLowerCase()] = value;
  return h;
}

function extractParts(payload) {
  let text = '';
  const attachments = [];
  (function walk(p) {
    if (!p) return;
    const mime = p.mimeType || '';
    if (mime === 'text/plain' && p.body && p.body.data) text += b64urlDecode(p.body.data).toString('utf8');
    else if (p.filename && p.body && p.body.attachmentId) attachments.push({ filename: p.filename, mimeType: mime, attachmentId: p.body.attachmentId });
    (p.parts || []).forEach(walk);
  })(payload);
  return { text: text.trim(), attachments };
}

module.exports = {
  canRead: true,
  canSend: true,

  async fetchNew(cfg, { label } = {}) {
    const tok = await token();
    let q;
    if (label) {
      if (!STATES.includes(label)) die(`Unknown state: ${label}`);
      q = `label:${cfg.labelPrefix}/${label}`;
    } else {
      const excl = STATES.map((s) => `-label:${cfg.labelPrefix}/${s}`).join(' ');
      q = `to:(${cfg.updateAddress}) newer_than:14d ${excl}`;
    }
    const list = await gapi(tok, `/messages?q=${encodeURIComponent(q)}`);
    const results = [];
    for (const { id } of list.messages || []) {
      const msg = await gapi(tok, `/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject`);
      const h = headersOf(msg.payload);
      results.push({ msgId: id, threadId: msg.threadId, from: h.from || '', subject: h.subject || '' });
    }
    return results;
  },

  async get(cfg, msgId) {
    const tok = await token();
    const msg = await gapi(tok, `/messages/${msgId}?format=full`);
    const h = headersOf(msg.payload);
    const { text, attachments } = extractParts(msg.payload);
    return {
      msgId, threadId: msg.threadId, from: h.from || '', to: h.to || '',
      subject: h.subject || '', date: h.date || '', messageIdHeader: h['message-id'] || '',
      internalDate: msg.internalDate, body: text, attachments,
    };
  },

  async downloadAttachments(cfg, msgId, destDir) {
    const tok = await token();
    const msg = await gapi(tok, `/messages/${msgId}?format=full`);
    const { attachments } = extractParts(msg.payload);
    fs.mkdirSync(destDir, { recursive: true });
    const written = [];
    for (const att of attachments) {
      const data = await gapi(tok, `/messages/${msgId}/attachments/${att.attachmentId}`);
      const safe = path.basename(att.filename).replace(/[^\w.\-]/g, '_');
      const dest = path.join(destDir, safe);
      fs.writeFileSync(dest, b64urlDecode(data.data));
      written.push({ filename: safe, mimeType: att.mimeType, path: dest, bytes: fs.statSync(dest).size });
    }
    return { msgId, destDir, written };
  },

  async label(cfg, msgId, state) {
    const tok = await token();
    const addId = await labelId(tok, cfg.labelPrefix, state);
    const removeIds = [];
    for (const s of STATES) if (s !== state) removeIds.push(await labelId(tok, cfg.labelPrefix, s));
    await gapi(tok, `/messages/${msgId}/modify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ addLabelIds: [addId], removeLabelIds: removeIds }),
    });
    return { msgId, state };
  },

  async threadReplies(cfg, msgId, sinceIso) {
    const tok = await token();
    const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
    const meta = await gapi(tok, `/messages/${msgId}?format=metadata`);
    const thread = await gapi(tok, `/threads/${meta.threadId}?format=full`);
    const replies = [];
    for (const m of thread.messages || []) {
      if (Number(m.internalDate) <= sinceMs) continue;
      const h = headersOf(m.payload);
      const { text } = extractParts(m.payload);
      replies.push({ msgId: m.id, from: h.from || '', date: h.date || '', internalDate: m.internalDate, body: text });
    }
    return { threadId: meta.threadId, replies };
  },

  // Send half. `msg` = {to, subject, inReplyTo, references, threadId, body}.
  async send(cfg, msg) {
    const tok = await token();
    const mime = [
      `To: ${msg.to}`,
      `Subject: ${reSubject(msg.subject)}`,
      msg.inReplyTo ? `In-Reply-To: ${msg.inReplyTo}` : '',
      msg.references ? `References: ${msg.references}` : '',
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0', '', msg.body,
    ].filter(Boolean).join('\r\n');
    const sent = await gapi(tok, '/messages/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: b64urlEncode(mime), threadId: msg.threadId }),
    });
    return { sentId: sent.id, threadId: msg.threadId };
  },
};
