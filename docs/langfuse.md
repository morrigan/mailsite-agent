# Langfuse tracing

Optional. When enabled, every scheduled Claude Code run is exported to
[Langfuse](https://langfuse.com) as one trace. You can see what the agent read,
which tools it called and what they returned, why a tick failed, and what each
run cost.

## Setup

1. Create a Langfuse project (cloud or self-hosted) and an API key pair under
   **Settings → API Keys**.
2. Add the keys to `<hub>/.env` (see `.env.example`):

   ```bash
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or https://us.cloud.langfuse.com, or self-hosted
   ```

3. From the hub root, install the hook's Python environment (Python 3.11+). It
   creates `<hub>/.venv-langfuse` and prints the hook's status without showing
   any secret values:

   ```bash
   bash mailsite-agent/scripts/setup-langfuse.sh
   ```

The Docker image already includes the environment. Setting the keys in `.env`
is enough there.

No other wiring is needed. The adapter's `settings.json` registers a Stop hook
(`adapters/claude-code/langfuse-hook.sh`), and `run-cron.sh` and `run-loop.sh`
set `MAILSITE_RUN_KIND`, which marks a run as scheduled.

## What a trace contains

```
process-inbox            agent       one per tick (repair-failed-run for a repair pass)
├─ decide-next-step      generation  one per model call: model, tokens, cost, tool calls
├─ Skill process-inbox   tool
├─ decide-next-step      generation
├─ Read                  tool
├─ mailsite-mail fetch-new  tool     Bash calls are named after the command they ran
└─ decide-next-step      generation  final answer = trace output
```

- **Trace input/output** are the run's prompt and the agent's final message.
- **Levels:** a failed tool call is `ERROR`, and so is a failed API call (for
  example a network outage). A trace is `WARNING` when a tool failed and
  `ERROR` when the model API failed. Filter on level to find broken ticks.
- **Metadata** on the root holds the clients touched, a count of each action,
  the models used, the Claude Code version and the session id. Each trace is
  tagged `claude-code` plus the run kind (`tick` or `repair`).
- **Environment:** `production` by default. Set `LANGFUSE_TRACING_ENVIRONMENT`
  to change it. **Release** is the `mailsite-agent` git commit.
- **Thinking:** Claude Code stores only the signature of thinking blocks, not
  the text, so generations note `thinking: omitted`. Thinking tokens are counted
  in output tokens.
- **Each generation's input** contains only the messages added since the
  previous model call (tool results, injected skill text). Read the trace top to
  bottom to see the full context.

Ticks are independent, so traces are not grouped into sessions.

## What is masked

Before anything is sent, the hook replaces:

- every client's `secretWord` from `clients.json` (owners put it in their emails,
  and the agent reads `clients.json` every run), and
- the value of every credential in `<hub>/.env` (any variable whose name
  contains KEY, TOKEN, SECRET, PASSWORD, PASS or CREDENTIAL), plus common token
  formats (GitHub, Anthropic, Google OAuth, Resend, bearer headers).

Everything else is sent as is, including owners' email addresses, email bodies,
and the content of files the agent reads. Long fields are cut at 20,000
characters (`MAILSITE_LANGFUSE_MAX_CHARS`). Images the agent reads are uploaded
as Langfuse media.

## Behaviour and limits

- **Fail-open.** The hook always exits 0. Errors go to `logs/langfuse-hook.log`,
  together with a link to each exported trace.
- **Scheduled runs only.** Interactive Claude Code sessions in the hub don't set
  `MAILSITE_RUN_KIND`, so they are never exported.
- **No trace if Claude Code itself crashes.** The Stop hook only runs when the
  agent finishes. A run the agent finished with an API error is still exported.
- **Goose** is not covered. Goose has its own Langfuse integration
  (`LANGFUSE_INIT_PROJECT_PUBLIC_KEY` and related variables), but it does not
  apply this masking, so secret words would be sent in clear.
- **Turn tracing off** by setting `MAILSITE_LANGFUSE=0` or removing the keys.

## Commands

```bash
PY=.venv-langfuse/bin/python HOOK=mailsite-agent/adapters/claude-code/langfuse_hook.py

$PY -I $HOOK --check                     # config status, no secret values
$PY -I $HOOK --transcript ~/.claude/projects/<hub-dir>/<session>.jsonl \
    --kind tick --environment development # export a past run (backfill or debugging)
```
