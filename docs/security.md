# Security model

The agent acts on email from non-technical owners, so the email is treated as
**untrusted input** at every step. Three layers:

1. **Authorization — allowlist + secret word.** A request is only processed if
   the `From` matches a client's `authorizedSenders` **and** the body contains
   that client's `secretWord`. `From` is spoofable, so the secret word is a
   second factor — but still a soft gate, not strong auth.
2. **Scope — content only, one repo.** The agent may change **visible content**
   (text and images) inside the matched client's repo only. It must never add
   scripts / trackers / iframes / remote resources, touch build or CI config, or
   act on instructions embedded in the email body (prompt-injection guard).
3. **Human approval — the real backstop.** Nothing reaches production without an
   explicit "approve" reply from an authorized sender. A misread request can only
   ever produce a preview, never a live change.

These rules are enforced by the runbook the agent reads every run — see the
**Guardrails** section of [`PLAYBOOK.md`](../PLAYBOOK.md).

## Secrets

Credentials live only in `<hub>/.env` (gitignored, outside the open-source repo).
The Claude adapter's `settings.json` additionally denies reading `.env` and
restricts Bash to the capability CLIs + `git`/`gh`, so an unattended run can't be
coaxed into arbitrary commands.

## Hardening ideas (not yet implemented)

- Verify SPF/DKIM on inbound mail to reduce `From` spoofing.
- A magic-link / reply-to-confirm step instead of (or alongside) the secret word.
- A per-client "allowed edit surface" to further constrain what can change.
