# Self-healing loop

For unattended operation, run `bin/run-loop.sh`. It is the one native runtime: a
long-running process that supervises each tick and keeps going through failures.
The OS only keeps the process alive; the loop schedules its own ticks. That is
why one model works on every platform (see "Running it" below).

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
`run-loop.sh`, so `docker compose up` is self-healing on any OS, including Windows.
Start the Resend listener separately if you use it (see [providers.md](providers.md)).

**Native**: install the loop as a service so it starts on boot and restarts on
crash. One command detects your OS and installs the right supervisor:

```bash
bash mailsite-agent/scripts/install-service.sh install
# also: uninstall | status | print (dry-run, installs nothing)
```

| OS | Supervisor it installs | Keep-alive mechanism |
|----|------------------------|----------------------|
| macOS | launchd user agent (`ops/macos/com.mailsite.loop.plist`) | `KeepAlive` |
| Linux (systemd) | systemd **user** service (`ops/linux/mailsite-loop.service`) | `Restart=always` |
| Linux (no systemd) | prints a cron `@reboot` + `nohup` line | cron at boot |
| Windows | points you at Docker or WSL2 | Docker restart policy |

On Linux, run `sudo loginctl enable-linger $USER` once so the user service keeps
running when you are not logged in (the installer prints this reminder).

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
