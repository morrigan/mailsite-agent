# Architecture

## Why it's built this way

The design is **ports & adapters**. All the deterministic work lives in small
CLIs with a JSON contract; the LLM agent only supplies judgment — reading the
request and authoring the HTML edit in the site's existing style. That buys three
things:

1. **Agent-agnostic.** Claude Code and Goose both ship as thin adapters that read
   the same [`PLAYBOOK.md`](../PLAYBOOK.md) and call the same CLIs. Adding another
   agent is one small adapter directory; the core is untouched.
2. **Safe.** The email is treated as untrusted input — allowlist + per-client
   secret word, content-only edits scoped to one repo, and nothing published
   without an explicit human approval reply. See [security.md](security.md).
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
| deploy | `bin/mailsite-deploy` — pluggable hosts | netlify · cloudflare (Vercel/others droppable) |
| image  | `scripts/optimize-image.sh` (ImageMagick/cwebp) | anything with the same CLI shape |
| vcs    | `git` + `gh`                  | — |

Each port is a CLI with a JSON contract, so a new backend is a drop-in module —
the PLAYBOOK and the other ports never change. The how-to for writing one is in
[ports-and-adapters.md](ports-and-adapters.md). Provider/host specifics are in
[providers.md](providers.md) and [hosting.md](hosting.md).

## The run loop

A scheduled tick runs two sweeps and exits (idempotent — safe to re-run):

```
Owner email ─▶ agent verifies sender ─▶ edits site ─▶ host preview
            ─▶ emails preview link ─▶ owner replies "approve" ─▶ published
```

- **Sweep A (intake):** verify sender + secret word → author the edit on a branch
  → push → wait for the deploy preview → reply with the preview link.
- **Sweep B (approvals):** on an "approve" reply, merge to production and confirm;
  on a correction, revise the same branch and re-preview.

The full step-by-step is the authoritative [`PLAYBOOK.md`](../PLAYBOOK.md).

## Open-source core vs. private hub

The publishable repo is this `mailsite-agent/` directory — generic engine only.
A user's private data lives in the **parent hub**, outside the repo:

```
<hub>/                         # private: never committed
  clients.json  .env           # who the clients are + secrets
  sites/<client-id>/           # each client's site repo
  logs/                        # runtime state (mail-state, resend-inbox, logs)
  active-agent → …             # symlink selecting the runner
  mailsite-agent/              # THIS repo (open source)
```

So "how to process an update email and deploy it" is generic and shippable;
"who my clients are and where their sites live" stays private.
