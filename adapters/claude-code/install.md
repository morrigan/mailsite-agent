# Install the Claude Code adapter

From the hub root (the directory containing `clients.json` and `mailsite-agent/`):

```bash
# 1. Wire the skill + permissions into the hub's .claude dir
mkdir -p .claude/skills
ln -sf ../../mailsite-agent/adapters/claude-code/SKILL.md .claude/skills/process-inbox.md
ln -sf ../mailsite-agent/adapters/claude-code/settings.json .claude/settings.json

# 2. Select this adapter as the active runner
ln -sfn mailsite-agent/adapters/claude-code active-agent

# 3. Try one tick by hand (watch logs/run.log)
./active-agent/run-cron.sh
tail -f logs/run.log
```

Run it unattended by installing the self-healing loop as a service. One command
detects your OS (launchd on macOS, systemd on Linux) and installs it:

```bash
bash mailsite-agent/scripts/install-service.sh install
```

See [docs/self-healing.md](../../docs/self-healing.md) for the per-OS details and
the Docker alternative.

Requirements: `claude` CLI logged in; `.env` has `NETLIFY_AUTH_TOKEN` plus
whatever your providers need (see [docs/providers.md](../../docs/providers.md)).

If `logs/run.log` shows `claude not found` (exit 127): the service runs with a
minimal PATH. `run-cron.sh` searches the usual install locations, but if yours is
elsewhere, set the absolute path in `.env`:

```bash
echo "MAILSITE_CLAUDE_BIN=$(command -v claude)" >> .env
```

(A bare cron entry, unlike launchd and systemd, does not export `HOME`; add
`HOME=/path/to/home` to the crontab if you use the cron fallback.)
