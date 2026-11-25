#!/usr/bin/env python3
"""
Export a headless mailsite-agent run (Claude Code) to Langfuse as one trace.

Registered as a Claude Code Stop hook in adapters/claude-code/settings.json and
invoked through langfuse-hook.sh. It reads the session transcript Claude Code
names on stdin and builds:

    agent       process-inbox | repair-failed-run     (root; trace input/output)
      generation  decide-next-step                    (one per model call: model,
                                                       tokens, thinking, tool calls)
      tool        mailsite-mail fetch-new, Read, ...  (siblings of the generation
                                                       that requested them)

Every string is passed through a masking function before it leaves the machine:
each client's secretWord (clients.json) and every credential in <hub>/.env is
replaced with a placeholder.

Fail-open: any problem is logged to <hub>/logs/langfuse-hook.log and the hook
exits 0, so tracing can never break or block a run.

Requires the Langfuse Python SDK 5.x (see scripts/setup-langfuse.sh). Uses only
public SDK APIs: a private TracerProvider lets observations carry the real
timestamps from the transcript instead of the time the hook runs.

Usage (normally run by Claude Code with the hook payload on stdin):
    langfuse_hook.py                          # Stop hook mode
    langfuse_hook.py --check                  # print config status, no secrets
    langfuse_hook.py --transcript F --kind tick [--environment development]
                                              # export an existing transcript
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import traceback
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

RUN_KINDS = {
    "tick": "process-inbox",
    "repair": "repair-failed-run",
}
GENERATION_NAME = "decide-next-step"
DEFAULT_MAX_CHARS = 20000
STATE_KEEP = 500
FLUSH_TIMEOUT_S = 25.0

SECRET_ENV_KEY = re.compile(r"(KEY|TOKEN|SECRET|PASSWORD|PASS|CREDENTIAL)", re.I)
# Credential shapes that can show up in tool output even if not in .env.
GENERIC_SECRET_PATTERNS = [
    re.compile(r"sk-lf-[A-Za-z0-9-]{8,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_-]{16,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}"),
    re.compile(r"\bya29\.[A-Za-z0-9_-]{20,}"),
    re.compile(r"\b1//[A-Za-z0-9_-]{20,}"),  # Google refresh tokens
    re.compile(r"(?i)(authorization:\s*bearer\s+)[A-Za-z0-9._~+/=-]{12,}"),
]
DATA_URI = re.compile(r"^data:[\w/+.-]+;base64,", re.I)


# --------------------------------------------------------------------------- #
# Hub configuration
# --------------------------------------------------------------------------- #
def find_hub() -> Path:
    for cand in (os.environ.get("MAILSITE_HUB"), os.environ.get("CLAUDE_PROJECT_DIR")):
        if cand and (Path(cand) / "mailsite-agent").is_dir():
            return Path(cand).resolve()
    # adapters/claude-code/langfuse_hook.py -> hub is three levels up
    return Path(__file__).resolve().parents[3]


def parse_dotenv(path: Path) -> Dict[str, str]:
    out: Dict[str, str] = {}
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        if line.startswith("export "):
            line = line[len("export "):]
        key, _, val = line.partition("=")
        key, val = key.strip(), val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "\"'":
            val = val[1:-1]
        out[key] = val
    return out


@dataclass
class Config:
    hub: Path
    env: Dict[str, str]
    secrets: List[Tuple[str, str]]  # (value, label)
    client_ids: List[str]
    max_chars: int

    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        # Process env wins, so a one-off run can override the hub .env.
        return os.environ.get(key) or self.env.get(key) or default


def load_config() -> Config:
    hub = find_hub()
    env = parse_dotenv(hub / ".env")

    secrets: List[Tuple[str, str]] = []
    for k, v in env.items():
        # The Langfuse public key is a project identifier the SDK sends anyway.
        if v and len(v) >= 6 and SECRET_ENV_KEY.search(k) and k != "LANGFUSE_PUBLIC_KEY":
            secrets.append((v, f"env:{k}"))

    client_ids: List[str] = []
    try:
        clients = json.loads((hub / "clients.json").read_text(encoding="utf-8"))
        for c in clients.get("clients", []):
            if c.get("id"):
                client_ids.append(str(c["id"]))
            if c.get("secretWord"):
                secrets.append((str(c["secretWord"]), "secretWord"))
    except (OSError, ValueError):
        pass

    # Longest first so a secret containing another is replaced whole.
    secrets.sort(key=lambda s: len(s[0]), reverse=True)

    try:
        max_chars = int(os.environ.get("MAILSITE_LANGFUSE_MAX_CHARS") or env.get("MAILSITE_LANGFUSE_MAX_CHARS") or DEFAULT_MAX_CHARS)
    except ValueError:
        max_chars = DEFAULT_MAX_CHARS
    return Config(hub=hub, env=env, secrets=secrets, client_ids=client_ids, max_chars=max_chars)


# --------------------------------------------------------------------------- #
# Logging (to the hub's logs/, never to stdout: Claude Code reads hook stdout)
# --------------------------------------------------------------------------- #
_LOG_PATH: Optional[Path] = None


def log(msg: str) -> None:
    if _LOG_PATH is None:
        return
    try:
        _LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        with open(_LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(f"{datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} {msg}\n")
    except OSError:
        pass


# --------------------------------------------------------------------------- #
# Masking
# --------------------------------------------------------------------------- #
def make_masker(secrets: List[Tuple[str, str]]) -> Callable[..., Any]:
    compiled = [(re.compile(re.escape(v), re.I), f"[REDACTED:{label}]") for v, label in secrets]

    def mask_str(s: str) -> str:
        if DATA_URI.match(s):
            return s  # media payload, uploaded separately by the SDK
        for rx, repl in compiled:
            s = rx.sub(repl, s)
        for rx in GENERIC_SECRET_PATTERNS:
            if rx.groups:
                s = rx.sub(lambda m: m.group(1) + "[REDACTED]", s)
            else:
                s = rx.sub("[REDACTED]", s)
        return s

    def mask(data: Any = None, **_: Any) -> Any:
        if isinstance(data, str):
            return mask_str(data)
        if isinstance(data, dict):
            return {k: mask(v) for k, v in data.items()}
        if isinstance(data, (list, tuple)):
            return [mask(v) for v in data]
        return data

    return mask


# --------------------------------------------------------------------------- #
# Transcript parsing
# --------------------------------------------------------------------------- #
def parse_ts(row: Any) -> Optional[datetime]:
    v = row.get("timestamp") if isinstance(row, dict) else row
    if not isinstance(v, str) or not v:
        return None
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None


def to_ns(ts: Optional[datetime]) -> Optional[int]:
    return int(ts.timestamp() * 1_000_000_000) if ts else None


def content_of(row: Dict[str, Any]) -> Any:
    m = row.get("message")
    return m.get("content") if isinstance(m, dict) else None


def blocks(content: Any) -> List[Dict[str, Any]]:
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    if isinstance(content, list):
        return [b for b in content if isinstance(b, dict)]
    return []


def text_of(content: Any) -> str:
    return "\n".join(b.get("text", "") for b in blocks(content) if b.get("type") == "text" and b.get("text"))


def is_tool_result_row(row: Dict[str, Any]) -> bool:
    return row.get("type") == "user" and any(b.get("type") == "tool_result" for b in blocks(content_of(row)))


@dataclass
class AssistantMsg:
    msg_id: str
    model: Optional[str]
    rows: List[Dict[str, Any]] = field(default_factory=list)
    preceding: List[Dict[str, Any]] = field(default_factory=list)  # chat messages since previous call
    start_ts: Optional[datetime] = None

    @property
    def end_ts(self) -> Optional[datetime]:
        ts = [parse_ts(r) for r in self.rows]
        ts = [t for t in ts if t]
        return max(ts) if ts else None

    @property
    def first_ts(self) -> Optional[datetime]:
        ts = [parse_ts(r) for r in self.rows]
        ts = [t for t in ts if t]
        return min(ts) if ts else None

    @property
    def api_error(self) -> Optional[str]:
        """Claude Code records a failed API call as a '<synthetic>' assistant message."""
        for r in self.rows:
            if r.get("isApiErrorMessage") or (r.get("message") or {}).get("model") == "<synthetic>":
                return text_of(content_of(r)) or str(r.get("error") or "API error")
        return None

    def content_blocks(self) -> List[Dict[str, Any]]:
        # Claude Code writes one row per content block, all sharing message.id.
        out: List[Dict[str, Any]] = []
        for r in self.rows:
            out.extend(blocks(content_of(r)))
        return out

    def usage(self) -> Optional[Dict[str, int]]:
        u = None
        for r in self.rows:
            m = r.get("message") or {}
            if isinstance(m.get("usage"), dict):
                u = m["usage"]  # last row carries the final counts
        if not u:
            return None
        out: Dict[str, int] = {}
        for src, dst in (
            ("input_tokens", "input"),
            ("output_tokens", "output"),
            ("cache_read_input_tokens", "cache_read_input_tokens"),
            ("cache_creation_input_tokens", "cache_creation_input_tokens"),
        ):
            v = u.get(src)
            if isinstance(v, int) and v > 0:
                out[dst] = v
        return out or None


@dataclass
class Turn:
    prompt_row: Dict[str, Any]
    calls: List[AssistantMsg]
    tool_results: Dict[str, Dict[str, Any]]  # tool_use_id -> {block, row}
    last_ts: Optional[datetime]


def build_turns(rows: List[Dict[str, Any]]) -> List[Turn]:
    """Group transcript rows into turns.

    A turn starts at a real user prompt. isMeta user rows (skill bodies that
    Claude Code injects after a Skill tool call) and tool results belong to the
    current turn and become the input of the next model call.
    """
    turns: List[Turn] = []
    cur: Optional[Turn] = None
    by_id: Dict[str, AssistantMsg] = {}
    pending: List[Dict[str, Any]] = []
    pending_ts: Optional[datetime] = None

    def close() -> None:
        if cur and cur.calls:
            turns.append(cur)

    for row in rows:
        if row.get("isSidechain"):
            continue  # subagent rows; not used by the playbook
        rtype = row.get("type")
        ts = parse_ts(row)

        if rtype == "user" and not is_tool_result_row(row) and not row.get("isMeta"):
            close()
            cur = Turn(prompt_row=row, calls=[], tool_results={}, last_ts=ts)
            by_id, pending, pending_ts = {}, [{"role": "user", "content": text_of(content_of(row))}], ts
            continue
        if cur is None:
            continue
        if ts:
            cur.last_ts = max(cur.last_ts, ts) if cur.last_ts else ts

        if rtype == "user" and is_tool_result_row(row):
            for b in blocks(content_of(row)):
                if b.get("type") == "tool_result" and b.get("tool_use_id"):
                    tid = str(b["tool_use_id"])
                    cur.tool_results[tid] = {"block": b, "row": row}
                    pending.append({"role": "tool", "tool_call_id": tid, "content": b.get("content")})
            pending_ts = ts or pending_ts
            continue

        if rtype == "user" and row.get("isMeta"):
            t = text_of(content_of(row))
            if t:
                pending.append({"role": "user", "content": t})
            continue

        if rtype == "assistant":
            m = row.get("message") or {}
            mid = m.get("id") or f"noid-{len(cur.calls)}"
            am = by_id.get(mid)
            if am is None:
                am = AssistantMsg(msg_id=mid, model=m.get("model"), preceding=pending, start_ts=pending_ts)
                by_id[mid] = am
                cur.calls.append(am)
                pending, pending_ts = [], None
            am.rows.append(row)
            if m.get("model"):
                am.model = m["model"]

    close()
    return turns


# --------------------------------------------------------------------------- #
# Formatting helpers
# --------------------------------------------------------------------------- #
def truncate(s: str, max_chars: int) -> str:
    if len(s) <= max_chars:
        return s
    return s[:max_chars] + f"\n…[truncated {len(s) - max_chars} of {len(s)} chars]"


def tool_result_content(content: Any, max_chars: int) -> Any:
    """Tool result -> text, or OpenAI-style parts when it contains images."""
    if isinstance(content, str):
        return truncate(content, max_chars)
    parts: List[Dict[str, Any]] = []
    has_media = False
    for b in blocks(content):
        if b.get("type") == "text":
            parts.append({"type": "text", "text": truncate(b.get("text", ""), max_chars)})
        elif b.get("type") == "image" and isinstance(b.get("source"), dict) and b["source"].get("type") == "base64":
            src = b["source"]
            parts.append({"type": "image_url", "image_url": {"url": f"data:{src.get('media_type', 'image/png')};base64,{src.get('data', '')}"}})
            has_media = True
        else:
            parts.append({"type": "text", "text": f"[{b.get('type', 'block')} omitted]"})
    if not has_media:
        return truncate("\n".join(p.get("text", "") for p in parts), max_chars)
    return parts


def format_input_messages(msgs: List[Dict[str, Any]], max_chars: int) -> List[Dict[str, Any]]:
    out = []
    for m in msgs:
        m = dict(m)
        if m.get("role") == "tool":
            m["content"] = tool_result_content(m.get("content"), max_chars)
        elif isinstance(m.get("content"), str):
            m["content"] = truncate(m["content"], max_chars)
        out.append(m)
    return out


def format_assistant_output(am: AssistantMsg, max_chars: int) -> Dict[str, Any]:
    text, thinking, redacted, calls = [], [], [], []
    for b in am.content_blocks():
        t = b.get("type")
        if t == "text" and b.get("text"):
            text.append(b["text"])
        elif t == "thinking" and b.get("thinking"):
            thinking.append({"type": "thinking", "content": truncate(b["thinking"], max_chars)})
        elif t == "redacted_thinking":
            redacted.append({"type": "redacted_thinking", "data": "[omitted]"})
        elif t == "tool_use":
            calls.append({
                "id": b.get("id"),
                "type": "function",
                "function": {"name": b.get("name"), "arguments": truncate(json.dumps(b.get("input"), ensure_ascii=False), max_chars)},
            })
    out: Dict[str, Any] = {"role": "assistant", "content": truncate("\n\n".join(text), max_chars)}
    if thinking:
        out["thinking"] = thinking
    if redacted:
        out["redacted_thinking"] = redacted
    if calls:
        out["tool_calls"] = calls
    return out


_MULTI = {"mailsite-mail": 1, "mailsite-deploy": 1, "git": 1, "gh": 2, "npm": 1, "node": 0}
_SKIP_CMDS = {"cd", "echo", "export", "set", "true", ":", "printf", "sleep"}


def bash_tool_name(command: str) -> str:
    """Stable, low-cardinality name for a Bash call: 'mailsite-mail fetch-new', 'git commit'."""
    segments = re.split(r"&&|\|\||;|\|", command or "")
    for seg in segments:
        try:
            toks = shlex.split(seg, posix=True)
        except ValueError:
            toks = seg.split()
        while toks and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", toks[0]):
            toks = toks[1:]  # leading VAR=value
        if not toks:
            continue
        exe = os.path.basename(toks[0])
        if exe in ("node", "bash", "sh") and len(toks) > 1:
            toks, exe = toks[1:], os.path.basename(toks[1])
        if exe in _SKIP_CMDS:
            continue
        exe = re.sub(r"\.(sh|js|py)$", "", exe)
        n = _MULTI.get(exe, 0)
        subs = [t for t in toks[1:1 + n] if not t.startswith("-")]
        return " ".join([exe] + subs)
    return "bash"


def tool_obs_name(name: str, tool_input: Any) -> str:
    if name == "Bash" and isinstance(tool_input, dict):
        return bash_tool_name(str(tool_input.get("command", "")))
    if name == "Skill" and isinstance(tool_input, dict) and tool_input.get("skill"):
        return f"Skill {tool_input['skill']}"
    return name or "tool"


def clients_touched(turn: Turn, known: List[str]) -> List[str]:
    found = set()
    for am in turn.calls:
        for b in am.content_blocks():
            if b.get("type") != "tool_use":
                continue
            blob = json.dumps(b.get("input"), ensure_ascii=False)
            for m in re.finditer(r"sites/([a-z0-9][a-z0-9-]*)", blob):
                found.add(m.group(1))
            for m in re.finditer(r"mailsite-deploy\s+(?:preview|publish|status)\s+([a-z0-9][a-z0-9-]*)", blob):
                found.add(m.group(1))
    if known:
        found &= set(known)
    return sorted(found)


def git_release(hub: Path) -> Optional[str]:
    try:
        r = subprocess.run(["git", "-C", str(hub / "mailsite-agent"), "rev-parse", "--short", "HEAD"],
                           capture_output=True, text=True, timeout=3)
        return r.stdout.strip() or None
    except Exception:
        return None


# --------------------------------------------------------------------------- #
# Emission
# --------------------------------------------------------------------------- #
def emit_turn(lf: Any, tracer: Any, cfg: Config, turn: Turn, *, run_kind: str, session_id: str,
              transcript: Path, environment: Optional[str], release: Optional[str]) -> str:
    from langfuse import LangfuseAgent, LangfuseGeneration, LangfuseTool, propagate_attributes
    from opentelemetry import trace as otel

    mc = cfg.max_chars
    root_name = RUN_KINDS.get(run_kind, run_kind)
    prompt_ts = parse_ts(turn.prompt_row)
    prompt_text = truncate(text_of(content_of(turn.prompt_row)), mc)
    final = format_assistant_output(turn.calls[-1], mc)
    models = sorted({am.model for am in turn.calls if am.model and am.model != "<synthetic>"})
    clients = clients_touched(turn, cfg.client_ids)

    tool_calls = 0
    tool_errors = 0
    api_errors: List[str] = []
    actions: Dict[str, int] = {}
    common = dict(langfuse_client=lf, environment=environment, release=release)

    with propagate_attributes(
        trace_name=root_name,
        tags=["claude-code", run_kind],
        metadata={"runner": "claude-code", "run_kind": run_kind, "claude_session_id": session_id},
    ):
        root_span = tracer.start_span(root_name, start_time=to_ns(prompt_ts))
        root = LangfuseAgent(otel_span=root_span, input=prompt_text, **common)
        root_ctx = otel.set_span_in_context(root_span)

        for idx, am in enumerate(turn.calls):
            gen_start = am.start_ts or am.first_ts or prompt_ts
            gspan = tracer.start_span(GENERATION_NAME, context=root_ctx, start_time=to_ns(gen_start))
            gen_meta: Dict[str, Any] = {"step": idx + 1, "message_id": am.msg_id}
            if any(b.get("type") == "thinking" and not b.get("thinking") for b in am.content_blocks()):
                # Claude Code keeps only the signature; the text was never written to the transcript.
                gen_meta["thinking"] = "omitted by Claude Code (counted in output tokens)"
            err = am.api_error
            if err:
                api_errors.append(err)
            gen = LangfuseGeneration(
                otel_span=gspan,
                model=None if err else am.model,
                input=format_input_messages(am.preceding, mc),
                output=None if err else format_assistant_output(am, mc),
                usage_details=None if err else am.usage(),
                metadata=gen_meta,
                level="ERROR" if err else None,
                status_message=err,
                **common,
            )
            gen.end(end_time=to_ns(am.end_ts or gen_start))

            for b in am.content_blocks():
                if b.get("type") != "tool_use":
                    continue
                tool_calls += 1
                tid = str(b.get("id") or "")
                tname = b.get("name") or "tool"
                tinput = b.get("input")
                oname = tool_obs_name(tname, tinput)
                actions[oname] = actions.get(oname, 0) + 1
                use_ts = next((parse_ts(r) for r in am.rows if any(x.get("id") == tid for x in blocks(content_of(r)))), None)
                res = turn.tool_results.get(tid)
                res_block = res["block"] if res else {}
                res_ts = parse_ts(res["row"]) if res else None
                is_err = bool(res_block.get("is_error"))
                tool_errors += int(is_err)
                output = tool_result_content(res_block.get("content"), mc) if res else None

                tspan = tracer.start_span(oname, context=root_ctx, start_time=to_ns(use_ts or am.end_ts))
                tool = LangfuseTool(
                    otel_span=tspan,
                    input=tinput if not isinstance(tinput, str) else truncate(tinput, mc),
                    output=output,
                    metadata={"tool": tname, "tool_call_id": tid, "step": idx + 1, **({"no_result": True} if not res else {})},
                    level="ERROR" if is_err else None,
                    status_message=(truncate(output, 500) if is_err and isinstance(output, str) else None),
                    **common,
                )
                tool.end(end_time=to_ns(res_ts or use_ts or am.end_ts))

        if api_errors:
            level, status = "ERROR", api_errors[-1]
        elif tool_errors:
            level, status = "WARNING", f"{tool_errors} tool call(s) failed"
        else:
            level, status = None, None
        root.update(
            output=None if turn.calls[-1].api_error else (final.get("content") or None),
            level=level,
            status_message=status,
            metadata={
                "claude_session_id": session_id,
                "claude_version": turn.prompt_row.get("version"),
                "cwd": turn.prompt_row.get("cwd"),
                "transcript": str(transcript),
                "models": models,
                "clients": clients,
                "model_calls": len(turn.calls),
                "tool_calls": tool_calls,
                "tool_errors": tool_errors,
                "actions": actions,
                "api_errors": len(api_errors),
            },
        )
        root.end(end_time=to_ns(turn.last_ts or prompt_ts))

    return format(root_span.get_span_context().trace_id, "032x")


# --------------------------------------------------------------------------- #
# State (avoid exporting the same turn twice if Stop fires again)
# --------------------------------------------------------------------------- #
def state_path(cfg: Config) -> Path:
    return cfg.hub / "logs" / "langfuse-hook-state.json"


def load_state(cfg: Config) -> List[str]:
    try:
        v = json.loads(state_path(cfg).read_text(encoding="utf-8"))
        return v if isinstance(v, list) else []
    except (OSError, ValueError):
        return []


def save_state(cfg: Config, done: List[str]) -> None:
    p = state_path(cfg)
    try:
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(done[-STATE_KEEP:]), encoding="utf-8")
        os.replace(tmp, p)
    except OSError as e:
        log(f"state save failed: {e}")


def turn_key(session_id: str, turn: Turn) -> str:
    pid = turn.prompt_row.get("promptId") or turn.prompt_row.get("uuid") or ""
    return hashlib.sha256(f"{session_id}:{pid}".encode()).hexdigest()[:24]


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def make_client(cfg: Config, environment: Optional[str], release: Optional[str]):
    import langfuse
    from langfuse import Langfuse
    from opentelemetry.sdk.resources import Resource
    from opentelemetry.sdk.trace import TracerProvider

    public_key = cfg.get("LANGFUSE_PUBLIC_KEY")
    provider = TracerProvider(resource=Resource.create({"service.name": "mailsite-agent"}))
    lf = Langfuse(
        public_key=public_key,
        secret_key=cfg.get("LANGFUSE_SECRET_KEY"),
        base_url=cfg.get("LANGFUSE_BASE_URL") or cfg.get("LANGFUSE_HOST") or "https://cloud.langfuse.com",
        environment=environment,
        release=release,
        mask=make_masker(cfg.secrets),
        tracer_provider=provider,
    )
    # Same instrumentation scope the SDK uses for its own spans, so Langfuse maps
    # these exactly like SDK-created observations. Our tracer only exists to set
    # explicit start times (the SDK's start_observation has no start_time).
    tracer = provider.get_tracer("langfuse-sdk", getattr(langfuse, "__version__", None),
                                 attributes={"public_key": public_key})
    return lf, tracer, provider


def shutdown(lf: Any, provider: Any) -> None:
    def _run() -> None:
        try:
            lf.flush()
            lf.shutdown()
            provider.shutdown()
        except Exception as e:
            log(f"flush failed: {e}")
    t = threading.Thread(target=_run, daemon=True)
    t.start()
    t.join(FLUSH_TIMEOUT_S)
    if t.is_alive():
        log(f"flush did not finish within {FLUSH_TIMEOUT_S}s; some spans may be lost")


def run(transcript: Path, session_id: str, run_kind: str, environment: Optional[str], cfg: Config, *, force: bool = False) -> int:
    rows = []
    with open(transcript, encoding="utf-8", errors="replace") as fh:
        for line in fh:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
    turns = build_turns(rows)
    if not turns:
        log(f"session={session_id} no complete turn in transcript; nothing to export")
        return 0

    done = load_state(cfg)
    todo = [t for t in turns if force or turn_key(session_id, t) not in done]
    if not todo:
        return 0

    release = git_release(cfg.hub)
    lf, tracer, provider = make_client(cfg, environment, release)
    try:
        for t in todo:
            try:
                trace_id = emit_turn(lf, tracer, cfg, t, run_kind=run_kind, session_id=session_id,
                                     transcript=transcript, environment=environment, release=release)
                done.append(turn_key(session_id, t))
                url = None
                try:
                    url = lf.get_trace_url(trace_id=trace_id)
                except Exception:
                    pass
                log(f"exported {RUN_KINDS.get(run_kind, run_kind)} session={session_id} trace={trace_id} {url or ''}".rstrip())
            except Exception as e:
                log(f"emit failed session={session_id}: {type(e).__name__}: {e}\n{traceback.format_exc()}")
    finally:
        shutdown(lf, provider)
        save_state(cfg, done)
    return 0


def main() -> int:
    global _LOG_PATH
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--check", action="store_true", help="print configuration status (no secret values) and exit")
    ap.add_argument("--transcript", type=Path, help="export this transcript instead of reading a hook payload")
    ap.add_argument("--session-id", help="session id for --transcript (default: file name)")
    ap.add_argument("--kind", choices=sorted(RUN_KINDS), default=None, help="run kind for --transcript")
    ap.add_argument("--environment", help="Langfuse environment (default: LANGFUSE_TRACING_ENVIRONMENT or 'production')")
    ap.add_argument("--force", action="store_true", help="export even if this turn was exported before")
    args = ap.parse_args()

    cfg = load_config()
    _LOG_PATH = cfg.hub / "logs" / "langfuse-hook.log"

    pk, sk = cfg.get("LANGFUSE_PUBLIC_KEY"), cfg.get("LANGFUSE_SECRET_KEY")
    if args.check:
        try:
            import langfuse
            sdk = langfuse.__version__ if hasattr(langfuse, "__version__") else "installed"
        except Exception as e:
            sdk = f"MISSING ({e})"
        print(json.dumps({
            "hub": str(cfg.hub),
            "langfuse_sdk": sdk,
            "public_key": "set" if pk else "missing",
            "secret_key": "set" if sk else "missing",
            "base_url": cfg.get("LANGFUSE_BASE_URL") or cfg.get("LANGFUSE_HOST") or "https://cloud.langfuse.com (default)",
            "environment": cfg.get("LANGFUSE_TRACING_ENVIRONMENT") or "production (default)",
            "masked_values": {"secretWord": sum(1 for _, l in cfg.secrets if l == "secretWord"),
                              "env_credentials": sum(1 for _, l in cfg.secrets if l.startswith("env:"))},
            "enabled": bool(pk and sk) and os.environ.get("MAILSITE_LANGFUSE", "1") != "0",
        }, indent=2))
        return 0

    if os.environ.get("MAILSITE_LANGFUSE", "1") == "0" or not (pk and sk):
        return 0
    environment = args.environment or cfg.get("LANGFUSE_TRACING_ENVIRONMENT") or "production"

    if args.transcript:
        sid = args.session_id or args.transcript.stem
        return run(args.transcript, sid, args.kind or "tick", environment, cfg, force=args.force)

    # Hook mode: only scheduled runs set MAILSITE_RUN_KIND (run-cron.sh / run-loop.sh),
    # so interactive Claude Code sessions in the hub are never exported.
    run_kind = os.environ.get("MAILSITE_RUN_KIND")
    if not run_kind:
        return 0
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except ValueError:
        payload = {}
    sid = payload.get("session_id") or payload.get("sessionId")
    tpath = payload.get("transcript_path") or payload.get("transcriptPath")
    if not sid or not tpath or not Path(tpath).expanduser().exists():
        log(f"hook payload missing session/transcript (keys={sorted(payload)})")
        return 0
    return run(Path(tpath).expanduser(), sid, run_kind, environment, cfg)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # fail open, always
        log(f"unexpected failure: {type(e).__name__}: {e}\n{traceback.format_exc()}")
        sys.exit(0)
