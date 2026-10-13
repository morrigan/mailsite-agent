# mailsite-agent runtime image.
#
# Bundles everything deterministic — Node, the capability CLIs' system deps
# (ImageMagick + WebP), git, GitHub CLI, the IMAP provider's node packages, and
# the Claude Code CLI — so a first-time user doesn't install anything natively.
#
# The hub (clients.json, .env, sites/, mailsite-agent/) is mounted at /hub; the
# container just runs the scheduler loop. Build context = the mailsite-agent dir.
FROM node:22-slim

# System deps for the image + VCS ports.
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates curl gnupg imagemagick webp \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
       | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
       > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# Claude Code CLI (headless runner). Goose can be added similarly if preferred.
RUN npm install -g @anthropic-ai/claude-code

# IMAP provider packages installed globally; NODE_PATH makes them require-able
# from the mounted hub. Gmail/Resend providers need none of this.
RUN npm install -g imapflow nodemailer mailparser
ENV NODE_PATH=/usr/local/lib/node_modules

ENV MAILSITE_HUB=/hub
WORKDIR /hub

COPY docker/scheduler.sh /usr/local/bin/scheduler.sh
RUN chmod +x /usr/local/bin/scheduler.sh

CMD ["/usr/local/bin/scheduler.sh"]
