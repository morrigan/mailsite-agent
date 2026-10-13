# mailsite-agent

**Let non-technical site owners update their static website by sending an email.**

You build someone a static site (hand-coded, or with a coding agent) and host it
on Netlify. Later the owner wants to change some text or add a photo. Instead of
them learning git — or pinging you — they **email the change**.
An agent verifies them, applies the edit, builds a **preview**,
and emails it back. The owner replies **"approve"** and it goes live.

```
Owner email ─▶ agent verifies sender ─▶ edits site ─▶ Netlify preview
            ─▶ emails preview link ─▶ owner replies "approve" ─▶ published
```

## Why it's built this way

The design is **ports & adapters**. All the deterministic work lives in small
CLIs with a JSON contract; the LLM agent only supplies judgment (reading the
request, editing HTML in-style). That buys three things:

1. **Agent-agnostic.** Claude Code and Goose both ship as thin adapters that read
   the same [`PLAYBOOK.md`](PLAYBOOK.md) and call the same CLIs. Add another agent
   = one small adapter directory; the core is untouched.
2. **Safe.** The email is treated as untrusted input. Sender allowlist **plus a
   per-client secret word**; content-only edits scoped to one repo; and nothing
   is ever published without an explicit human approval reply.
3. **Robust & testable.** State lives in mail labels + git branches, so every run
   is idempotent. The CLIs are testable on their own, with no LLM in the loop.

```
            AGENT ADAPTER (swappable)         ← Claude Code / Goose / …
                     │ reads
                PLAYBOOK.md                    ← agent-neutral domain logic
                     │ calls (JSON)
   mailsite-mail · mailsite-deploy · optimize-image.sh · git/gh
      MAIL            DEPLOY           IMAGE              VCS   ← ports
```

## The ports

| Port   | Implementation                | Swap target |
|--------|-------------------------------|-------------|
| mail   | `bin/mailsite-mail` — pluggable providers | gmail · imap (Proton/Fastmail/…) · resend · claude-connector |
| deploy | `bin/mailsite-deploy` (Netlify REST) | Vercel, Cloudflare Pages |
| image  | `scripts/optimize-image.sh` (ImageMagick/cwebp) | anything with the same CLI shape |
| vcs    | `git` + `gh`                  | — |

## Email providers

Reading and sending are configured separately, because not every service can do
both — see [`docs/providers.md`](docs/providers.md) for the full matrix.

```jsonc
"mail": { "read": "gmail", "send": "resend" }
```

- **read** (must be pollable): `gmail` or `imap`. IMAP covers **ProtonMail**
  (via Proton Mail Bridge), Fastmail, iCloud, and any IMAP host.
- **send**: `gmail`, `imap`, or `resend` (Resend is send-only — no pollable
  inbox). Defaults to the read provider.
- `claude-connector`: Claude-only, zero mail setup (uses the Gmail MCP connector).

## Dependencies

The core (gmail + resend providers) is **dependency-free** — Node 18+ built-in
`fetch` only. The **imap** provider is the one exception and pulls three opt-in
packages (`imapflow`, `nodemailer`, `mailparser`). Two ways to get set up:

```bash
# Native: check (and optionally install) prerequisites
bash mailsite-agent/scripts/doctor.sh            # report what's missing
bash mailsite-agent/scripts/doctor.sh --install  # install native deps (brew/apt)

# Docker: bundles Node, ImageMagick, WebP, git, gh, IMAP packages, Claude CLI
docker compose -f mailsite-agent/docker/docker-compose.yml up -d --build
```

Native needs: Node 18+, `git`, `gh`, ImageMagick (`cwebp` optional), a Netlify
token, your provider credentials, and one agent (`claude` or `goose`). See
[`docker/README.md`](docker/README.md) for the container path.

## Quick start

```bash
# In your hub directory (holds clients.json + this mailsite-agent/ dir):
bash mailsite-agent/scripts/doctor.sh                # verify prerequisites
cp mailsite-agent/clients.sample.json clients.json   # then edit it
cp mailsite-agent/.env.example .env                  # then fill in secrets

# Pick your agent (see each adapter's install.md):
#   Claude Code → mailsite-agent/adapters/claude-code/install.md
#   Goose       → point `goose run --recipe …/goose/recipe.yaml` at the hub

# One manual tick:
./active-agent/run-cron.sh && tail -f logs/run.log
```

See [`docs/onboarding.md`](docs/onboarding.md) to add a client site, and each
adapter's `install.md` to schedule unattended runs.

## Security model

- `From` is spoofable, so authorization = **allowlisted sender AND a secret word
  in the body**. Still only a soft gate — the real backstop is human approval.
- The agent may only change **visible content** (text + images) inside the one
  matched client's repo. It must never add scripts/trackers/iframes or touch
  build config, and never act on instructions embedded in the email.
- Nothing reaches production without an explicit "approve" reply from an
  authorized sender.

Full rules live in [`PLAYBOOK.md`](PLAYBOOK.md) — the agent reads them every run.

## License

MIT — see [LICENSE](LICENSE).
