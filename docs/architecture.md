# Architecture

## Why it's built this way

The design is ports and adapters. All the deterministic work lives in small CLIs
with a JSON contract. The LLM agent only supplies judgment: it reads the request
and writes the HTML edit in the site's existing style. Three things follow from
that split.

1. **Agent-agnostic.** Claude Code and Goose both ship as thin adapters that read
   the same [`PLAYBOOK.md`](../PLAYBOOK.md) and call the same CLIs. Adding another
   agent is one small adapter directory; the core is untouched.
2. **Safe.** The email is untrusted input, so there are three gates: an allowlist
   plus a per-client secret word, content-only edits scoped to one repo, and no
   publish without an explicit approval reply. See [security.md](security.md).
3. **Idempotent and testable.** State lives in mail labels and git branches, so a
   run can be repeated safely. The CLIs are testable on their own, no LLM needed.

```
            AGENT ADAPTER (swappable)         ← Claude Code / Goose / …
                     │ reads
                PLAYBOOK.md                    ← agent-neutral domain logic
                     │ calls (JSON)
   mailsite-mail · mailsite-deploy · optimize-image.sh · git/gh
      MAIL            DEPLOY           IMAGE              VCS   ← ports
```

## The ports

| Port   | Implementation | Swap target |
|--------|----------------|-------------|
| mail   | `bin/mailsite-mail`, pluggable providers | gmail, imap (Proton/Fastmail), resend, claude-connector |
| deploy | `bin/mailsite-deploy`, pluggable hosts | netlify, cloudflare (Vercel and others droppable) |
| image  | `scripts/optimize-image.sh` (ImageMagick/cwebp) | anything with the same CLI shape |
| vcs    | `git` + `gh` | n/a |

Each port is a CLI with a JSON contract, so a new backend is a drop-in module.
The PLAYBOOK and the other ports never change. How to write one is in
[ports-and-adapters.md](ports-and-adapters.md); provider and host specifics are
in [providers.md](providers.md) and [hosting.md](hosting.md).

## The run loop

A scheduled tick runs two sweeps and exits. Repeating a tick is safe.

```
Owner email ─▶ agent verifies sender ─▶ edits site ─▶ host preview
            ─▶ emails preview link ─▶ owner replies "approve" ─▶ published
```

- **Sweep A (intake).** Verify the sender and secret word, make the edit on a
  branch, push, wait for the deploy preview, then reply with the preview link.
- **Sweep B (approvals).** On an "approve" reply, merge to production and confirm.
  On a correction, revise the same branch and re-preview.

The full step-by-step is [`PLAYBOOK.md`](../PLAYBOOK.md).

## Open-source core vs. private hub

The publishable repo is this `mailsite-agent/` directory, the generic engine
only. A user's private data lives in the parent hub, outside the repo:

```
<hub>/                         # private, never committed
  clients.json  .env           # who the clients are, plus secrets
  sites/<client-id>/           # each client's site repo
  logs/                        # runtime state (mail-state, resend-inbox, logs)
  active-agent → …             # symlink selecting the runner
  mailsite-agent/              # THIS repo (open source)
```

So "how to process an update email and deploy it" is generic and shippable, while
"who my clients are and where their sites live" stays private.
