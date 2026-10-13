# mailsite-agent

**Let non-technical site owners update their static website by sending an email.**

You build someone a static site (hand-coded, or with a coding agent) and host it
on Netlify or Cloudflare Pages. Later the owner wants to change some text or add a
photo. Instead of them learning git — or pinging you — they **email the change**.
An agent verifies them, authors the edit, builds a **preview**, and emails it
back. The owner replies **"approve"** and it goes live.

```
Owner email ─▶ agent verifies sender ─▶ edits site ─▶ host preview
            ─▶ emails preview link ─▶ owner replies "approve" ─▶ published
```

It's **agent-agnostic** (runs under Claude Code or Goose), works with multiple
**mail** providers (Gmail, IMAP/ProtonMail, Resend) and **hosts** (Netlify,
Cloudflare Pages), and never publishes without explicit approval. How it all fits
together is in [docs/architecture.md](docs/architecture.md).

## Requirements

- Node 18+, `git`, GitHub CLI `gh`, and ImageMagick (`cwebp` optional).
- One runner: Claude Code (`claude`) **or** Goose (`goose`).
- A host token (Netlify/Cloudflare) and your mail provider's credentials.

The core is dependency-free; only the IMAP provider pulls extra packages. Or skip
native installs entirely and use Docker (see [docker/README.md](docker/README.md)).

## Setup

Run from your **hub** directory — the folder that contains this `mailsite-agent/`:

```bash
bash mailsite-agent/scripts/doctor.sh          # check (--install to auto-install) prerequisites
node mailsite-agent/bin/mailsite-setup         # interactive wizard
```

The wizard asks for your runner, mail provider(s) + credentials, and first client
+ host, then writes `clients.json` and `.env`, wires the `active-agent` symlink,
and prints tailored next steps. Then:

```bash
git clone <repo> sites/<client-id>                   # the site to manage
./active-agent/run-cron.sh && tail -f logs/run.log   # one manual tick
```

Prefer to configure by hand? Copy `clients.sample.json` → `clients.json` and
`.env.example` → `.env` and edit them.

To run unattended, schedule `active-agent/run-cron.sh` — see your adapter's
`install.md` (launchd/cron) or [docker/README.md](docker/README.md).

## Documentation

- [architecture.md](docs/architecture.md) — how it works: ports & adapters, the run loop, the open-source/private split
- [providers.md](docs/providers.md) — mail providers (Gmail, IMAP/ProtonMail, Resend) and how to choose read vs send
- [hosting.md](docs/hosting.md) — hosting providers (Netlify, Cloudflare Pages)
- [onboarding.md](docs/onboarding.md) — add a new client site
- [security.md](docs/security.md) — the trust model and guardrails
- [ports-and-adapters.md](docs/ports-and-adapters.md) — extend it: add a mail/deploy provider or a new agent
- [PLAYBOOK.md](PLAYBOOK.md) — the authoritative runbook the agent executes

## License

MIT — see [LICENSE](LICENSE).
