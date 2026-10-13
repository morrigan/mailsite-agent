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
If `clients.json` sets `mail.read: "claude-connector"`, authorize the Gmail
connector in Claude; the skill then uses MCP tools for mail and needs no `GMAIL_*`.
