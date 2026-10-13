'use strict';
// IMAP/SMTP provider — covers any IMAP mailbox: ProtonMail (via Proton Mail
// Bridge), Fastmail, iCloud, generic hosts. Reads over IMAP, sends over SMTP.
//
// State "labels" are stored as IMAP custom keywords ("<prefix>_<State>") since
// not every server supports arbitrary labels; keyword support still varies by
// server, so validate against yours (see docs/providers.md).
//
// Optional deps (installed only if you use IMAP): imapflow, nodemailer, mailparser
// Env: IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD,
//      SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM

const fs = require('fs');
const path = require('path');
const { STATES, die, reSubject } = require('../common');

function need(mod) {
  try { return require(mod); }
  catch { die(`IMAP provider needs the "${mod}" package. Run: npm install --prefix mailsite-agent imapflow nodemailer mailparser`); }
}

function keyword(prefix, state) { return `${prefix}_${state}`.replace(/[^A-Za-z0-9_]/g, '_'); }

function imapConfig() {
  const { IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD } = process.env;
  if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) die('IMAP provider needs IMAP_HOST / IMAP_USER / IMAP_PASSWORD in .env');
  return { host: IMAP_HOST, port: Number(IMAP_PORT || 993), secure: Number(IMAP_PORT || 993) === 993, auth: { user: IMAP_USER, pass: IMAP_PASSWORD } };
}

async function withClient(fn) {
  const { ImapFlow } = need('imapflow');
  const client = new ImapFlow({ ...imapConfig(), logger: false });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try { return await fn(client); }
  finally { lock.release(); await client.logout(); }
}

async function parseSource(source) {
  const { simpleParser } = need('mailparser');
  return simpleParser(source);
}

module.exports = {
  canRead: true,
  canSend: true,

  async fetchNew(cfg, { label } = {}) {
    return withClient(async (client) => {
      let criteria;
      if (label) {
        if (!STATES.includes(label)) die(`Unknown state: ${label}`);
        criteria = { keyword: keyword(cfg.labelPrefix, label) };
      } else {
        criteria = { to: cfg.updateAddress, since: new Date(Date.now() - 14 * 864e5) };
      }
      const uids = await client.search(criteria, { uid: true });
      const results = [];
      for await (const m of client.fetch({ uid: uids }, { uid: true, envelope: true, flags: true }, { uid: true })) {
        if (!label) {
          const flags = m.flags || new Set();
          if (STATES.some((s) => flags.has(keyword(cfg.labelPrefix, s)))) continue; // already in a state
        }
        const env = m.envelope || {};
        const from = (env.from && env.from[0]) ? `${env.from[0].name || ''} <${env.from[0].address}>`.trim() : '';
        results.push({ msgId: String(m.uid), threadId: env.messageId || String(m.uid), from, subject: env.subject || '' });
      }
      return results;
    });
  },

  async get(cfg, msgId) {
    return withClient(async (client) => {
      const { content } = await client.download(msgId, undefined, { uid: true });
      const chunks = []; for await (const c of content) chunks.push(c);
      const parsed = await parseSource(Buffer.concat(chunks));
      return {
        msgId, threadId: parsed.messageId || msgId,
        from: parsed.from ? parsed.from.text : '',
        to: parsed.to ? parsed.to.text : '',
        subject: parsed.subject || '', date: parsed.date ? parsed.date.toISOString() : '',
        messageIdHeader: parsed.messageId || '',
        internalDate: parsed.date ? String(parsed.date.getTime()) : '',
        body: (parsed.text || '').trim(),
        attachments: (parsed.attachments || []).map((a, i) => ({ filename: a.filename || `attachment-${i}`, mimeType: a.contentType, attachmentId: String(i) })),
      };
    });
  },

  async downloadAttachments(cfg, msgId, destDir) {
    return withClient(async (client) => {
      const { content } = await client.download(msgId, undefined, { uid: true });
      const chunks = []; for await (const c of content) chunks.push(c);
      const parsed = await parseSource(Buffer.concat(chunks));
      fs.mkdirSync(destDir, { recursive: true });
      const written = [];
      (parsed.attachments || []).forEach((a, i) => {
        const safe = path.basename(a.filename || `attachment-${i}`).replace(/[^\w.\-]/g, '_');
        const dest = path.join(destDir, safe);
        fs.writeFileSync(dest, a.content);
        written.push({ filename: safe, mimeType: a.contentType, path: dest, bytes: a.content.length });
      });
      return { msgId, destDir, written };
    });
  },

  async label(cfg, msgId, state) {
    return withClient(async (client) => {
      const add = keyword(cfg.labelPrefix, state);
      const remove = STATES.filter((s) => s !== state).map((s) => keyword(cfg.labelPrefix, s));
      await client.messageFlagsAdd(msgId, [add], { uid: true });
      if (remove.length) await client.messageFlagsRemove(msgId, remove, { uid: true });
      return { msgId, state };
    });
  },

  async threadReplies(cfg, msgId, sinceIso) {
    return withClient(async (client) => {
      // Resolve the original Message-ID, then find messages that reference it.
      const orig = await module.exports.get(cfg, msgId);
      const sinceMs = sinceIso ? Date.parse(sinceIso) : 0;
      const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 30 * 864e5);
      const uids = await client.search({ since, header: { references: orig.messageIdHeader } }, { uid: true });
      const replies = [];
      for (const uid of uids) {
        const { content } = await client.download(String(uid), undefined, { uid: true });
        const chunks = []; for await (const c of content) chunks.push(c);
        const parsed = await parseSource(Buffer.concat(chunks));
        const t = parsed.date ? parsed.date.getTime() : 0;
        if (t <= sinceMs) continue;
        replies.push({ msgId: String(uid), from: parsed.from ? parsed.from.text : '', date: parsed.date ? parsed.date.toISOString() : '', internalDate: String(t), body: (parsed.text || '').trim() });
      }
      return { threadId: orig.messageIdHeader, replies };
    });
  },

  async send(cfg, msg) {
    const nodemailer = need('nodemailer');
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM, IMAP_USER } = process.env;
    if (!SMTP_HOST) die('IMAP send needs SMTP_HOST (and usually SMTP_USER/SMTP_PASSWORD, SMTP_FROM) in .env');
    const port = Number(SMTP_PORT || 465);
    const transport = nodemailer.createTransport({
      host: SMTP_HOST, port, secure: port === 465,
      auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined,
    });
    const info = await transport.sendMail({
      from: SMTP_FROM || IMAP_USER, to: msg.to, subject: reSubject(msg.subject),
      inReplyTo: msg.inReplyTo || undefined, references: msg.references || undefined, text: msg.body,
    });
    return { sentId: info.messageId };
  },
};
