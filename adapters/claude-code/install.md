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

Schedule it with launchd:

```bash
sed "s#REPLACE_ME/hub#$PWD#g" \
  mailsite-agent/adapters/claude-code/com.mailsite.agent.plist \
  > ~/Library/LaunchAgents/com.mailsite.agent.plist
launchctl load ~/Library/LaunchAgents/com.mailsite.agent.plist
```

Requirements: `claude` CLI logged in; `.env` has `NETLIFY_AUTH_TOKEN` plus
whatever your providers need (see [docs/providers.md](../../docs/providers.md)).

If `logs/run.log` shows `claude not found` (exit 127): the scheduled job runs
with a minimal PATH. `run-cron.sh` searches the usual install locations, but if
yours is elsewhere, set the absolute path in `.env`:

```bash
echo "MAILSITE_CLAUDE_BIN=$(command -v claude)" >> .env
```

(cron, unlike launchd, also does not export `HOME`; add `HOME=/Users/you` to the
crontab if you schedule with cron instead of the provided launchd agent.)
