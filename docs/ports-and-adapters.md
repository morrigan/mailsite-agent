# Ports & adapters — how to extend mailsite-agent

The core knows nothing about Gmail, Netlify, Claude, or Goose. It knows about
four **ports** (capability contracts) and reads one **PLAYBOOK**. You extend the
system by writing a new adapter behind a port — never by editing the PLAYBOOK.

## The contract

Every port is a CLI that prints **JSON to stdout** and exits **non-zero on
error**. That is the whole interface. Any language, any backend.

### Mail port — `bin/mailsite-mail`

| Subcommand | Output shape |
|---|---|
| `fetch-new [--label <State>]` | `[{msgId, threadId, from, subject}]` |
| `get <msgId>` | `{msgId, threadId, from, to, subject, body, attachments:[{filename,mimeType,attachmentId}]}` |
| `download-attachments <msgId> <destDir>` | `{written:[{filename,path,bytes}]}` |
| `reply <msgId> --body-file <f>` | `{replied:true, sentId}` |
| `label <msgId> <State>` | `{msgId, state}` (sets one state label, clears the others) |
| `thread-replies <msgId> --since <iso>` | `{replies:[{from, internalDate, body}]}` |

States: `InProgress`, `AwaitingApproval`, `Published`, `Rejected`, `NeedsHuman`.
To add an IMAP adapter, implement these six subcommands in the `imap` branch of
`bin/mailsite-mail` (e.g. node-imap for reads/labels-as-flags, nodemailer to
send). No other file changes.

### Deploy port — `bin/mailsite-deploy`

Pluggable hosts (`bin/lib/deploy/*`), chosen per client via `hosting.provider`.
Ships with `netlify` and `cloudflare`.

| Subcommand | Output shape |
|---|---|
| `preview <clientId> --branch <b> [--pr <n>]` | `{state, url}` — `state` ∈ ready\|error\|building\|timeout |
| `publish <clientId>` | `{state, url}` |

Deploys are triggered by `git push` (host auto-builds); these providers observe
state and resolve URLs. A new host implements `preview`/`publish` in a module —
see [hosting.md](hosting.md). A `--dir` flag is reserved for future
direct-upload providers (e.g. `wrangler pages deploy`).

### Image port — `scripts/optimize-image.sh`

`optimize-image.sh <in> <out> [maxEdge] [quality]` → one JSON line
`{input, output, bytes}`. Downscale-only, strips metadata (incl. GPS).

### VCS port

Plain `git` + `gh`. No wrapper; the PLAYBOOK calls them directly.

## The agent is also an adapter

An agent adapter is a thin shim that (a) points the agent at `PLAYBOOK.md`,
(b) lets it run the port CLIs, and (c) provides a `run-cron.sh` for scheduling.
See `adapters/claude-code/` and `adapters/goose/` — each is only a handful of
files. The `active-agent` symlink in the hub selects which one runs.

### Adding a new agent

1. `mkdir adapters/<name>`.
2. Write its instruction/config file that says "read ./PLAYBOOK.md and follow it;
   here are the port CLIs." (Copy the Goose recipe's `instructions:` block — it's
   already agent-neutral prose.)
3. Write a `run-cron.sh` that takes a single-instance lock and invokes the agent headlessly.
4. `ln -sfn adapters/<name> active-agent` and run one tick.

Because every agent reads the identical PLAYBOOK and drives the identical CLIs,
behavior is the same across agents — the portability test in the project plan
(flip the symlink, re-run the end-to-end flow) should pass unchanged.
