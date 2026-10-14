# Running in Docker

The image bundles Node, ImageMagick, WebP, git, GitHub CLI, the IMAP packages,
and the Claude Code CLI, so you install nothing natively. The container runs the
self-healing supervisor loop (`run-loop.sh`), which retries and repairs on
failure instead of dying; see [../docs/self-healing.md](../docs/self-healing.md).
Your hub is mounted at `/hub`.

## When Docker makes sense

- You want one command and no native installs, or you're deploying to a server
  rather than a Mac.
- The catch: the LLM agent and git still need credentials passed in (below).

## Setup

From the hub root (the directory containing `clients.json` and `mailsite-agent/`):

```bash
# 1. Pick the Claude adapter as the active runner (one-time)
ln -sfn mailsite-agent/adapters/claude-code active-agent

# 2. Put credentials in .env (in addition to provider creds + NETLIFY_AUTH_TOKEN):
#    ANTHROPIC_API_KEY=...        # headless Claude Code auth
#    GH_TOKEN=...                 # lets git/gh push to the client repos
#    GIT_AUTHOR_NAME=...          # commit identity
#    GIT_AUTHOR_EMAIL=...

# 3. Build + run
docker compose -f mailsite-agent/docker/docker-compose.yml up -d --build

# 4. Watch it
docker compose -f mailsite-agent/docker/docker-compose.yml logs -f
tail -f logs/run.log
```

Change the poll interval with `MAILSITE_INTERVAL` (seconds) in the compose file.

## Native instead?

You don't need Docker. `bash mailsite-agent/scripts/doctor.sh --install` installs
the native prerequisites, then `bash mailsite-agent/scripts/install-service.sh`
installs the self-healing loop as a service for your OS (launchd on macOS,
systemd on Linux). See [docs/self-healing.md](../docs/self-healing.md).
