'use strict';
// Resend provider — SEND ONLY. Resend is a transactional-email API with no
// pollable inbox (inbound arrives via webhooks, which doesn't fit a scheduled
// poll loop). So Resend can be the `mail.send` provider, paired with a
// pollable `mail.read` provider (gmail or imap). No npm dependencies.
//
// Env: RESEND_API_KEY
// Config: cfg.resend.from  (a verified sender, e.g. "Updates <updates@you.com>")

const { die, reSubject } = require('../common');

const READ_NOT_SUPPORTED =
  'Resend cannot read mail (it has no pollable inbox). Set "mail.read" to "gmail" ' +
  'or "imap"; Resend may only be used as "mail.send".';

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
