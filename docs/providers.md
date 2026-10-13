# Email providers

mailsite-agent separates **reading** inbound requests from **sending** replies,
because not every service can do both. You configure them independently in
`clients.json`:

```jsonc
"mail": {
  "read": "gmail",     // inbound — MUST be pollable: gmail | imap
  "send": "resend"     // outbound — gmail | imap | resend (defaults to read)
}
```

## Capability matrix

| Provider | Read (poll inbox) | Send (reply) | Notes |
|----------|:-----------------:|:------------:|-------|
| **gmail** | ✅ poll | ✅ | Gmail REST API + OAuth2 refresh token. Dependency-free. |
| **imap**  | ✅ poll | ✅ (via SMTP) | Any IMAP host: **ProtonMail** (via Proton Mail Bridge), Fastmail, iCloud, generic. Needs the opt-in `imapflow`/`nodemailer`/`mailparser` packages. |
| **resend** | ⚠️ stream (needs inbound mode) | ✅ | Transactional + agent CLI. Inbound exists (`emails receiving listen`/`get`, verified receiving domain) but is a **stream with no state labels**, so reading needs the listener+state-store mode below. Drop-in as `send`. |
| **claude-connector** | ✅* | ✅* | *Only inside a Claude session via MCP; not a standalone CLI. The Claude adapter handles it. |

## Why reading is the constraint

Sending email is easy and every provider does it. **Receiving** is the hard part
for two reasons, and a read provider must satisfy both:

1. **Pollability.** The loop wakes every few minutes and asks "what's new since I
   last looked?" Gmail (API) and IMAP answer that directly. Resend's inbound is
   delivered as a **live NDJSON stream** (`resend emails receiving listen`) with
   no documented "list received since X" — a stream fits a persistent listener,
   not a stateless cron poll.
2. **State.** The engine tracks each request's progress
   (`InProgress`/`AwaitingApproval`/…) as a **label on the mail provider**, so a
   crashed run resumes correctly. Gmail has labels; IMAP has keywords. Resend
   inbound has neither.

So Gmail and IMAP are first-class readers today. Resend is a first-class
**sender** today, and can become a reader via a dedicated **inbound mode**:

### Resend inbound mode (optional, not built yet)

A long-running listener (`resend emails receiving listen --json`) writes incoming
mail into a local store, and a local state store replaces provider-side labels.
That makes Resend pollable + stateful for this engine — at the cost of running
one always-on listener process (vs. the stateless cron tick). Ask if you want it;
until then, a great setup is **read via Gmail/IMAP, send via Resend**.

## Common combinations

| Goal | `mail.read` | `mail.send` | Extra setup |
|------|-------------|-------------|-------------|
| All-Gmail (simplest) | `gmail` | `gmail` | `GMAIL_*` in `.env` |
| ProtonMail mailbox | `imap` | `imap` | Proton Mail Bridge running; `IMAP_*` + `SMTP_*` |
| Read Gmail, send via Resend | `gmail` | `resend` | `GMAIL_*`, `RESEND_API_KEY`, `resend.from` |
| Read Proton, send via Resend | `imap` | `resend` | Bridge + `IMAP_*`, `RESEND_API_KEY`, `resend.from` |
| Claude-only, zero mail setup | `claude-connector` | `claude-connector` | Authorize the Gmail connector in Claude |

One combination at a time — switch by editing `clients.json` and the matching
`.env` values.

## Provider setup pointers

- **Gmail**: create an OAuth 2.0 *Desktop* client in Google Cloud, enable the
  Gmail API, and complete a one-time consent to get a refresh token with scopes
  `gmail.modify` + `gmail.send`. Put the three `GMAIL_*` values in `.env`.
- **IMAP / ProtonMail**: install Proton Mail Bridge (paid Proton plan), which
  gives you a local IMAP/SMTP host, port, and credentials — drop those into the
  `imap` block of `clients.json` and the `IMAP_*`/`SMTP_*` vars in `.env`. Then
  `npm install --prefix mailsite-agent imapflow nodemailer mailparser` (or use
  Docker, which bundles them). IMAP state uses custom keywords; keyword support
  varies by server, so verify labelling works against yours.
- **Resend**: verify your sending domain, create an API key (`RESEND_API_KEY`),
  and set `resend.from` to a verified sender in `clients.json`.

## Adding another provider

Implement a module in `bin/lib/providers/<name>.js` exporting `canRead`/`canSend`
and the relevant methods (`fetchNew`, `get`, `downloadAttachments`, `label`,
`threadReplies` for readers; `send` for senders). No other files change — see
[ports-and-adapters.md](ports-and-adapters.md).
