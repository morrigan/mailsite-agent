'use strict';
// Resend provider — SEND here; inbound reading is a separate mode (see below).
//
// Sending: Resend's transactional API. Dependency-free; drop-in as `mail.send`.
//   Env: RESEND_API_KEY   Config: cfg.resend.from (verified sender)
//
// Reading: Resend DOES support inbound via its agent CLI
//   (`resend emails receiving listen` streams NDJSON; `... receiving get <id>`
//   fetches a message with attachments; requires a verified domain with
//   receiving enabled). But that inbound model is a STREAM, not a pollable
//   "list since X", and Resend has no server-side labels — whereas this engine
//   drives its state machine with a stateless poll + provider-side state labels.
//   So using Resend as `mail.read` needs a persistent listener + a local state
//   store (the "Resend inbound mode"), not this stateless CLI path. Until that
//   mode is enabled, pair Resend (send) with gmail/imap (read). See
//   docs/providers.md.

const { die, reSubject } = require('../common');

const READ_NOT_SUPPORTED =
  'Resend inbound reading needs the listener + local-state-store mode (its CLI ' +
  'delivers inbound as a stream, and it has no state labels). For now set ' +
  '"mail.read" to "gmail" or "imap" and use Resend as "mail.send". See docs/providers.md.';

module.exports = {
  canRead: false,
  canSend: true,

  fetchNew() { die(READ_NOT_SUPPORTED); },
  get() { die(READ_NOT_SUPPORTED); },
  downloadAttachments() { die(READ_NOT_SUPPORTED); },
  label() { die(READ_NOT_SUPPORTED); },
  threadReplies() { die(READ_NOT_SUPPORTED); },

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
