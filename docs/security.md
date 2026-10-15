# Security model

The agent acts on email from non-technical owners, so the email is untrusted
input at every step. Three layers guard it.

1. **Authorization.** A request is processed only if the `From` matches a
   client's `authorizedSenders` and that client's `secretWord` appears in the
   subject or the body. `From` is spoofable, so the secret word is a second
   factor. It's still a soft gate, not strong auth.
2. **Scope.** The agent may change visible content (text and images) in the
   matched client's repo only. It must never add scripts, trackers, iframes, or
   remote resources, touch build or CI config, or act on instructions embedded in
   the email body. That last one is the prompt-injection guard.
3. **Human approval.** Nothing reaches production without an explicit "approve"
   reply from an authorized sender. A misread request can only ever produce a
   preview, never a live change.

These rules live in the runbook the agent reads every run. See the Guardrails
section of [`PLAYBOOK.md`](../PLAYBOOK.md).

## Secrets

Credentials live only in `<hub>/.env` (gitignored, outside the open-source repo).
The Claude adapter's `settings.json` also denies reading `.env` and restricts
Bash to the capability CLIs plus `git` and `gh`, so an unattended run can't be
coaxed into arbitrary commands.

## Hardening ideas (not yet implemented)

- Verify SPF/DKIM on inbound mail to reduce `From` spoofing.
- A magic-link or reply-to-confirm step, alongside or instead of the secret word.
- A per-client "allowed edit surface" to further constrain what can change.
