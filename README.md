# mailsite-agent

**Let non-technical site owners update their static website by sending an email.**

You build someone a static site (by hand, or with a coding agent) and host it on
Netlify or Cloudflare Pages. Later the owner wants to change some text or add a
photo. Instead of learning git or pinging you, they email the change. An agent
checks who sent it, makes the edit, builds a preview, and emails back the link.
The owner replies "approve" and it goes live.

```
Owner email ─▶ agent verifies sender ─▶ edits site ─▶ host preview
            ─▶ emails preview link ─▶ owner replies "approve" ─▶ published
```

It runs under Claude Code or Goose. It reads and sends mail through Gmail, IMAP
(ProtonMail via Bridge, Fastmail, any IMAP host), or Resend, and deploys to
Netlify or Cloudflare Pages. Nothing goes live without an approval reply.
[docs/architecture.md](docs/architecture.md) explains how it fits together.

## Setup

Run everything from your hub directory, the folder that contains this
`mailsite-agent/`. Both options need a Netlify or Cloudflare token and your mail
provider's credentials; Docker also needs `ANTHROPIC_API_KEY` and `GH_TOKEN` in
`.env`. Pick one.

### Option 1 - Docker

The image bundles Node, ImageMagick, WebP, `git`, `gh`, the IMAP packages, and
the Claude CLI, so you install nothing on your machine.

```bash
# Configure with the wizard in a container (writes clients.json + .env),
# or copy clients.sample.json and .env.example by hand and edit them:
docker compose -f mailsite-agent/docker/docker-compose.yml run --rm mailsite-agent \
  node /hub/mailsite-agent/bin/mailsite-setup

# Run it. The scheduler loops on its own:
docker compose -f mailsite-agent/docker/docker-compose.yml up -d --build
```

[docs/wizard.md](docs/wizard.md) explains every wizard prompt and where to find
each value. More, including the Resend listener service, in
[docker/README.md](docker/README.md).

### Option 2 - Native

Requires Node 18+, `git`, GitHub CLI `gh`, ImageMagick (`cwebp` optional), and
one runner, Claude Code (`claude`) or Goose (`goose`). The core has no
dependencies; only the IMAP provider pulls extra packages.

```bash
bash mailsite-agent/scripts/doctor.sh      # check prerequisites (--install to auto-install)
node mailsite-agent/bin/mailsite-setup     # wizard: writes clients.json + .env, wires active-agent
./active-agent/run-cron.sh                 # one manual run (schedule it via your adapter's install.md)
```

The wizard asks for your runner, mail provider(s) and credentials, and a first
client and host; [docs/wizard.md](docs/wizard.md) explains every prompt and where
to find each value. To configure by hand instead, copy `clients.sample.json` to
`clients.json` and `.env.example` to `.env` and edit them.

For unattended operation, run the self-healing supervisor
(`mailsite-agent/bin/run-loop.sh`) rather than a one-off tick. It retries,
repairs, and keeps running through failures. Docker runs it for you. See
[docs/self-healing.md](docs/self-healing.md).

### Then, for either option

```bash
git clone <repo> sites/<client-id>     # the website to manage (see docs/onboarding.md)
tail -f logs/run.log                   # watch runs
```

## Documentation

- [wizard.md](docs/wizard.md). Every setup-wizard prompt, and where to find each value.
- [self-healing.md](docs/self-healing.md). The supervisor loop that retries, repairs, and keeps running.
- [architecture.md](docs/architecture.md). Ports and adapters, the run loop, and the open-source vs private split.
- [providers.md](docs/providers.md). Mail providers, and how to choose read vs send.
- [hosting.md](docs/hosting.md). Netlify and Cloudflare Pages.
- [onboarding.md](docs/onboarding.md). Add a new client site.
- [security.md](docs/security.md). The trust model and guardrails.
- [ports-and-adapters.md](docs/ports-and-adapters.md). Add a mail or deploy provider, or a new agent.
- [PLAYBOOK.md](PLAYBOOK.md). The runbook the agent executes each run.

## License

MIT, see [LICENSE](LICENSE).
