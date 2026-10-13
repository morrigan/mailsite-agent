'use strict';
// claude-connector, NOT a standalone-CLI provider. Claude's Gmail connector is
// only reachable from inside a Claude session via MCP tools, not from a shell.
// When clients.json uses this, the Claude Code adapter's SKILL.md performs the
// mail steps with mcp__…Gmail__* tools instead of calling bin/mailsite-mail.
// For an agent-neutral setup, use "gmail" or "imap".

const { die } = require('../common');

const MSG =
  'mail provider "claude-connector" is not available as a standalone CLI.\n' +
  'The Claude Code adapter uses the Gmail MCP tools directly; for other agents\n' +
  'set mail.read / mail.send to "gmail" or "imap".';

const err = () => die(MSG);
module.exports = {
  canRead: true, canSend: true,
  fetchNew: err, get: err, downloadAttachments: err, label: err, threadReplies: err, send: err,
};
