# Self-healing loop

For unattended operation, run `bin/run-loop.sh` instead of a bare interval tick.
It supervises the normal run and keeps going through failures:

- It runs a tick (`active-agent/run-cron.sh`). On success it sleeps
  `MAILSITE_INTERVAL` and ticks again.
- On a failed tick it runs a bounded **agent repair pass** (see below) and
  retries once.
- After `MAILSITE_MAX_REPAIR` consecutive failures it opens a **circuit breaker**:
  it writes `logs/NEEDS_ATTENTION` and backs off, but stays running, so it
  recovers on its own once the cause clears. One bad tick never kills the loop.

Because a tick is idempotent (state lives in mail labels and git branches), a
half-finished run just resumes on the next tick.

## What the repair pass may and may not do

When a tick fails, the loop hands the recent run log to the agent and tells it to
follow [`REPAIR.md`](../REPAIR.md). That runbook scopes it to **operational
recovery**: clear a stuck lock, recover a crashed git working tree, install a
named missing dependency, or report a transient error as safe to retry.

It must not publish, merge, force-push, delete client content, touch secrets, or
weaken the approval gate. This is deliberate. The loop heals the run, it does not
rewrite a client's live site to make an error disappear. Ambiguous content
requests still go to `NeedsHuman` for a person, as before.

Turn the agent repair off with `MAILSITE_REPAIR=0` to retry without it.

## Running it

**Docker** already runs the loop: the container's `scheduler.sh` execs
`run-loop.sh`, so `docker compose up` is self-healing. Start the Resend listener
separately if you use it (see [providers.md](providers.md)).

**Native**: run the loop under a supervisor so it restarts if the machine
reboots. On macOS use the KeepAlive launchd agent:

```bash
sed "s#REPLACE_ME/hub#$PWD#g" \
  mailsite-agent/ops/com.mailsite.loop.plist \
  > ~/Library/LaunchAgents/com.mailsite.loop.plist
launchctl load ~/Library/LaunchAgents/com.mailsite.loop.plist
```

Run the loop **or** the interval tick
(`adapters/claude-code/com.mailsite.agent.plist`), not both. The loop is the one
that self-heals.

## Knobs

| Env | Default | Meaning |
|-----|---------|---------|
| `MAILSITE_INTERVAL` | `600` | seconds between healthy ticks |
| `MAILSITE_MAX_REPAIR` | `3` | consecutive failures before the breaker opens |
| `MAILSITE_REPAIR` | `1` | set `0` to retry without the agent repair pass |

## When it needs you

`logs/NEEDS_ATTENTION` means repeated failures the loop could not fix. Check
`logs/loop.log` for the breaker line and `logs/run.log` for the underlying error.
The file clears itself automatically on the next healthy tick.
