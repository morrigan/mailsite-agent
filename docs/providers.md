# Email providers

mailsite-agent separates reading inbound requests from sending replies, because
not every service can do both. You configure them independently in
`clients.json`:

```jsonc
"mail": {
  "read": "gmail",     // inbound (must be pollable): gmail | imap
  "send": "resend"     // outbound: gmail | imap | resend (defaults to read)
}
```

## Capability matrix

| Provider | Read (poll inbox) | Send (reply) | Notes |
|----------|:-----------------:|:------------:|-------|
| **gmail** | ✅ poll | ✅ | Gmail REST API + OAuth2 refresh token. No dependencies. |
| **imap**  | ✅ poll | ✅ (via SMTP) | Any IMAP host: ProtonMail (via Proton Mail Bridge), Fastmail, iCloud, generic. Needs the opt-in `imapflow`/`nodemailer`/`mailparser` packages. |
| **resend** | ✅ via inbound mode | ✅ | Transactional API plus an agent CLI. Send is a drop-in. Read works via Resend inbound mode (a listener plus a local state store), described below. Needs the `resend` CLI and a verified receiving domain. |
| **claude-connector** | ✅* | ✅* | *Only inside a Claude session via MCP, not a standalone CLI. The Claude adapter handles it. |

## Why reading is the constraint

Sending email is easy and every provider does it. Receiving is the hard part, for
two reasons, and a read provider has to satisfy both.

1. **Pollability.** The loop wakes every few minutes and asks what arrived since
   it last looked. Gmail (API) and IMAP answer that directly. Resend's inbound
   comes as a live NDJSON stream (`resend emails receiving listen`) with no
   documented way to list what arrived since a given time. A stream suits a
   persistent listener, not a stateless cron poll.
2. **State.** The engine tracks each request's progress
   (`InProgress`, `AwaitingApproval`, and so on) as a label on the mail provider,
   so a crashed run resumes correctly. Gmail has labels and IMAP has keywords.
   Resend inbound has neither.

Gmail and IMAP cover both directly. Resend needs a dedicated inbound mode that
supplies the missing pollability and state.

### Resend inbound mode

Two pieces make Resend a first-class reader.

1. **Listener.** `bin/mailsite-resend-listener` runs
   `resend emails receiving listen --json` continuously and writes each inbound
   email to `<hub>/logs/resend-inbox/<id>.json`. That turns the live stream into
   a pollable local maildir. Run it under a supervisor so it stays up:
   - macOS: `ops/com.mailsite.resend-listener.plist` (KeepAlive).
   - Docker: `docker compose -f mailsite-agent/docker/docker-compose.yml --profile resend up -d`.
2. **Local state store.** `bin/lib/state-store.js` records each message's state
   in `<hub>/logs/mail-state.json`, standing in for the labels Gmail and IMAP
   would hold.

With both running, the Resend provider meets the same mail-port contract as
Gmail and IMAP. The PLAYBOOK and the `bin/mailsite-mail` commands are identical;
only the storage underneath differs. Setup:

```bash
npm install -g resend-cli          # the CLI the listener drives
# .env: RESEND_API_KEY=...; clients.json: "mail": { "read": "resend", "send": "resend" }
# verify a receiving domain in Resend, then start the listener (launchd/Docker above)
```

The trade-off is operational. You run one always-on listener process instead of
relying on the stateless cron tick alone. To skip that, read via Gmail or IMAP
and send via Resend, which needs no listener.

> Field-mapping note: Resend's public docs don't pin the exact inbound JSON field
> names, so `bin/lib/providers/resend.js` extracts them defensively (trying
> several aliases). If your real payloads differ, adjust `normalize()` there.

## Common combinations

| Goal | `mail.read` | `mail.send` | Extra setup |
|------|-------------|-------------|-------------|
| All-Gmail (simplest) | `gmail` | `gmail` | `GMAIL_*` in `.env` |
| ProtonMail mailbox | `imap` | `imap` | Proton Mail Bridge running; `IMAP_*` + `SMTP_*` |
| Read Gmail, send via Resend | `gmail` | `resend` | `GMAIL_*`, `RESEND_API_KEY`, `resend.from` |
| Read Proton, send via Resend | `imap` | `resend` | Bridge + `IMAP_*`, `RESEND_API_KEY`, `resend.from` |
| All-Resend (needs listener) | `resend` | `resend` | `resend` CLI, receiving domain, listener running; `RESEND_API_KEY`, `resend.from` |
| Claude-only, zero mail setup | `claude-connector` | `claude-connector` | Authorize the Gmail connector in Claude |

One combination at a time. Switch by editing `clients.json` and the matching
`.env` values.

## Provider setup pointers

- **Gmail.** Create an OAuth 2.0 Desktop client in Google Cloud, enable the Gmail
  API, and complete a one-time consent to get a refresh token with scopes
  `gmail.modify` and `gmail.send`. Put the three `GMAIL_*` values in `.env`.
- **IMAP / ProtonMail.** Install Proton Mail Bridge (a paid Proton plan). It
  gives you a local IMAP/SMTP host, port, and credentials. Put those in the
  `imap` block of `clients.json` and the `IMAP_*`/`SMTP_*` vars in `.env`, then
  run `npm install --prefix mailsite-agent imapflow nodemailer mailparser` (or
  use Docker, which bundles them). IMAP state uses custom keywords, and keyword
  support varies by server, so check that labelling works against yours.
- **Resend.** Verify your sending domain, create an API key (`RESEND_API_KEY`),
  and set `resend.from` to a verified sender in `clients.json`.

## Adding another provider

Write a module in `bin/lib/providers/<name>.js` exporting `canRead`/`canSend` and
the relevant methods: `fetchNew`, `get`, `downloadAttachments`, `label`, and
`threadReplies` for readers; `send` for senders. No other files change. See
[ports-and-adapters.md](ports-and-adapters.md).
