#!/usr/bin/env python3
"""Local iMessage-to-Codex relay for this Mac.

This script intentionally uses only Python's standard library so it can run as a
LaunchAgent without project dependencies. It polls Messages' local SQLite
database for new allowlisted commands and sends replies through Messages via
AppleScript.
"""

from __future__ import annotations

import json
import logging
import os
import re
import shlex
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


HOME = Path.home()
DEFAULT_CONFIG_PATH = HOME / ".codex-imessage-relay" / "config.json"
DEFAULT_STATE_DIR = HOME / ".codex-imessage-relay"
DEFAULT_WORKSPACE = Path("/Users/vincex/Documents/SF Extension/Salesforce-Extension")
DEFAULT_CODEX = Path("/Applications/Codex.app/Contents/Resources/codex")
DEFAULT_MESSAGES_DB = HOME / "Library" / "Messages" / "chat.db"


DEFAULT_CONFIG: Dict[str, Any] = {
    "allowed_handles": [],
    "command_prefix": "codex run:",
    "workspace_path": str(DEFAULT_WORKSPACE),
    "codex_path": str(DEFAULT_CODEX),
    "messages_db": str(DEFAULT_MESSAGES_DB),
    "state_db": str(DEFAULT_STATE_DIR / "state.sqlite3"),
    "log_file": str(DEFAULT_STATE_DIR / "relay.log"),
    "lock_file": str(DEFAULT_STATE_DIR / "task.lock"),
    "poll_seconds": 5,
    "max_task_seconds": 1800,
    "reply_length_limit": 1800,
    "allow_push_deploy": True,
    "send_replies": True,
    "initialize_from_latest_message": True,
}


STOP = False


def handle_signal(_signum: int, _frame: Any) -> None:
    global STOP
    STOP = True


signal.signal(signal.SIGTERM, handle_signal)
signal.signal(signal.SIGINT, handle_signal)


def ensure_config(path: Path) -> Dict[str, Any]:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_text(json.dumps(DEFAULT_CONFIG, indent=2) + "\n", encoding="utf-8")
        os.chmod(path, 0o600)
        return dict(DEFAULT_CONFIG)

    with path.open("r", encoding="utf-8") as handle:
        loaded = json.load(handle)
    config = {**DEFAULT_CONFIG, **loaded}
    return config


def setup_logging(config: Dict[str, Any]) -> None:
    log_path = Path(config["log_file"]).expanduser()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=str(log_path),
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logging.getLogger().addHandler(console)


def normalize_handle(value: str) -> str:
    raw = str(value or "").strip().lower()
    if "@" in raw:
        return raw
    digits = re.sub(r"[^\d+]", "", raw)
    return digits or raw


def is_allowed_sender(handle: str, allowed_handles: Iterable[str]) -> bool:
    normalized = normalize_handle(handle)
    raw = str(handle or "").strip().lower()
    allowed = {normalize_handle(item) for item in allowed_handles if str(item or "").strip()}
    allowed_raw = {str(item or "").strip().lower() for item in allowed_handles if str(item or "").strip()}
    return normalized in allowed or raw in allowed_raw


def redact(value: str) -> str:
    text = str(value or "")
    patterns = [
        (r"github_pat_[A-Za-z0-9_]+", "github_pat_[REDACTED]"),
        (r"gh[pousr]_[A-Za-z0-9_]+", "gh_[REDACTED]"),
        (r"sk-[A-Za-z0-9_-]{20,}", "sk-[REDACTED]"),
        (r"(?i)(access[_ -]?token|refresh[_ -]?token|api[_ -]?key|password|secret)(\s*[:=]\s*)([^\s,;]+)", r"\1\2[REDACTED]"),
        (r"00D[A-Za-z0-9!._-]{20,}", "00D[REDACTED]"),
        (r"5Aep[A-Za-z0-9._-]{20,}", "5Aep[REDACTED]"),
    ]
    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text)
    return text


def truncate_reply(value: str, limit: int) -> str:
    text = redact(value).strip()
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 80)].rstrip() + "\n\n[truncated; see local relay log for full output]"


def open_state(config: Dict[str, Any]) -> sqlite3.Connection:
    state_path = Path(config["state_db"]).expanduser()
    state_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(state_path))
    conn.execute(
        """
        create table if not exists relay_state (
          key text primary key,
          value text not null
        )
        """
    )
    conn.execute(
        """
        create table if not exists processed_messages (
          guid text primary key,
          rowid integer not null,
          sender text,
          command text,
          status text,
          exit_code integer,
          received_at text default current_timestamp,
          completed_at text,
          summary text
        )
        """
    )
    conn.commit()
    return conn


def state_get(conn: sqlite3.Connection, key: str) -> Optional[str]:
    row = conn.execute("select value from relay_state where key = ?", (key,)).fetchone()
    return row[0] if row else None


def state_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "insert into relay_state (key, value) values (?, ?) on conflict(key) do update set value = excluded.value",
        (key, value),
    )
    conn.commit()


def current_max_message_rowid(messages_db: Path) -> int:
    uri = f"file:{messages_db}?mode=ro"
    with sqlite3.connect(uri, uri=True) as conn:
        row = conn.execute("select coalesce(max(ROWID), 0) from message").fetchone()
    return int(row[0] or 0)


def initialize_state_if_needed(state: sqlite3.Connection, config: Dict[str, Any]) -> None:
    if state_get(state, "last_rowid") is not None:
        return
    if config.get("initialize_from_latest_message", True):
        max_rowid = current_max_message_rowid(Path(config["messages_db"]).expanduser())
        state_set(state, "last_rowid", str(max_rowid))
        logging.info("Initialized last_rowid to current latest message rowid %s", max_rowid)
    else:
        state_set(state, "last_rowid", "0")


def fetch_new_commands(config: Dict[str, Any], state: sqlite3.Connection) -> List[Dict[str, Any]]:
    messages_db = Path(config["messages_db"]).expanduser()
    last_rowid = int(state_get(state, "last_rowid") or "0")
    prefix = str(config["command_prefix"])
    uri = f"file:{messages_db}?mode=ro"
    query = """
      select
        m.ROWID,
        m.guid,
        m.text,
        coalesce(h.id, '') as sender,
        m.service
      from message m
      left join handle h on h.ROWID = m.handle_id
      where m.ROWID > ?
        and m.is_from_me = 0
        and m.is_system_message = 0
        and m.item_type = 0
        and m.service = 'iMessage'
        and m.text is not null
        and lower(m.text) like lower(?)
      order by m.ROWID asc
      limit 20
    """
    with sqlite3.connect(uri, uri=True) as conn:
        conn.row_factory = sqlite3.Row
        rows = [dict(row) for row in conn.execute(query, (last_rowid, f"{prefix}%")).fetchall()]

        max_row = conn.execute(
            "select coalesce(max(ROWID), ?) from message where ROWID > ?",
            (last_rowid, last_rowid),
        ).fetchone()[0]
        if int(max_row or last_rowid) > last_rowid:
            state_set(state, "last_rowid", str(int(max_row)))

    return rows


def already_processed(state: sqlite3.Connection, guid: str) -> bool:
    return state.execute("select 1 from processed_messages where guid = ?", (guid,)).fetchone() is not None


def record_message(
    state: sqlite3.Connection,
    message: Dict[str, Any],
    command: str,
    status: str,
    exit_code: Optional[int] = None,
    summary: str = "",
) -> None:
    state.execute(
        """
        insert into processed_messages (guid, rowid, sender, command, status, exit_code, summary, completed_at)
        values (?, ?, ?, ?, ?, ?, ?, case when ? in ('completed', 'failed', 'rejected', 'busy') then current_timestamp else null end)
        on conflict(guid) do update set
          status = excluded.status,
          exit_code = excluded.exit_code,
          summary = excluded.summary,
          completed_at = excluded.completed_at
        """,
        (
            message.get("guid"),
            int(message.get("ROWID") or 0),
            message.get("sender") or "",
            command,
            status,
            exit_code,
            redact(summary)[:4000],
            status,
        ),
    )
    state.commit()


def send_imessage(handle: str, body: str, config: Dict[str, Any]) -> bool:
    if not config.get("send_replies", True):
        logging.info("Reply disabled. Would send to %s: %s", handle, body)
        return True
    script = """
on run argv
  set targetHandle to item 1 of argv
  set messageText to item 2 of argv
  tell application "Messages"
    set targetService to 1st service whose service type = iMessage
    set targetBuddy to buddy targetHandle of targetService
    send messageText to targetBuddy
  end tell
end run
"""
    try:
        subprocess.run(
            ["/usr/bin/osascript", "-e", script, str(handle), str(body)],
            check=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=30,
        )
        return True
    except Exception as exc:
        logging.exception("Failed to send iMessage reply to %s: %s", handle, exc)
        return False


class TaskLock:
    def __init__(self, lock_path: Path) -> None:
        self.lock_path = lock_path
        self.fd: Optional[int] = None

    def acquire(self) -> bool:
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            self.fd = os.open(str(self.lock_path), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(self.fd, str(os.getpid()).encode("utf-8"))
            return True
        except FileExistsError:
            return False

    def release(self) -> None:
        if self.fd is not None:
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None
        try:
            self.lock_path.unlink()
        except FileNotFoundError:
            pass


def build_codex_prompt(command: str, sender: str, config: Dict[str, Any]) -> str:
    push_deploy = "allowed" if config.get("allow_push_deploy", True) else "not allowed"
    return f"""You were triggered by an allowlisted iMessage sender on Vincent's Mac.

Sender: {sender}
Workspace: {config['workspace_path']}
Original request:
{command}

Execution policy for this iMessage relay:
- Work directly in the workspace above.
- You may inspect, edit, test, commit, push, and deploy when the request requires it.
- Push/deploy is currently {push_deploy} by relay configuration.
- If push/deploy is not allowed, stop after local verification and explain what remains.
- Keep changes scoped to the user's request.
- Protect secrets: never print tokens, passwords, refresh tokens, API keys, or full credential values.
- Prefer lint/build verification for code changes.
- If a command fails because credentials or macOS permissions are missing, report the exact blocker and next action.
- Final response must be concise and include changed files, checks run, commit hash, deployment URL when applicable, and any remaining blocker.
"""


def run_codex(command: str, sender: str, config: Dict[str, Any]) -> Dict[str, Any]:
    codex_path = Path(config["codex_path"]).expanduser()
    workspace = Path(config["workspace_path"]).expanduser()
    max_seconds = int(config.get("max_task_seconds") or 1800)
    prompt = build_codex_prompt(command, sender, config)

    with tempfile.TemporaryDirectory(prefix="codex-imessage-") as tmp_dir:
        last_message = Path(tmp_dir) / "last-message.txt"
        args = [
            str(codex_path),
            "exec",
            "-C",
            str(workspace),
            "--sandbox",
            "danger-full-access",
            "--ask-for-approval",
            "never",
            "--output-last-message",
            str(last_message),
            prompt,
        ]
        logging.info("Starting Codex task: %s", shlex.join(args[:8] + ["..."]))
        try:
            proc = subprocess.run(
                args,
                cwd=str(workspace),
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=max_seconds,
            )
            final = last_message.read_text(encoding="utf-8", errors="replace") if last_message.exists() else ""
            output = final.strip() or proc.stdout.strip() or proc.stderr.strip()
            return {
                "exit_code": proc.returncode,
                "summary": output,
                "stdout": proc.stdout,
                "stderr": proc.stderr,
            }
        except subprocess.TimeoutExpired as exc:
            return {
                "exit_code": 124,
                "summary": f"Codex task timed out after {max_seconds} seconds.",
                "stdout": exc.stdout or "",
                "stderr": exc.stderr or "",
            }


def process_message(config: Dict[str, Any], state: sqlite3.Connection, message: Dict[str, Any]) -> None:
    guid = str(message.get("guid") or "")
    sender = str(message.get("sender") or "")
    text = str(message.get("text") or "")
    prefix = str(config["command_prefix"])
    command = text[len(prefix) :].strip()
    limit = int(config.get("reply_length_limit") or 1800)

    if not guid or already_processed(state, guid):
        return

    if not is_allowed_sender(sender, config.get("allowed_handles", [])):
        logging.warning("Rejected command from non-allowlisted sender %s", sender)
        record_message(state, message, command, "rejected", 403, "Sender is not allowlisted.")
        send_imessage(sender, "Codex relay rejected this command: sender is not allowlisted.", config)
        return

    if not command:
        record_message(state, message, command, "rejected", 400, "Missing command after prefix.")
        send_imessage(sender, f"Codex relay rejected this command: add text after `{prefix}`.", config)
        return

    lock = TaskLock(Path(config["lock_file"]).expanduser())
    if not lock.acquire():
        record_message(state, message, command, "busy", 409, "Another Codex task is already running.")
        send_imessage(sender, "Codex is busy with another iMessage task. Please retry after it finishes.", config)
        return

    try:
        record_message(state, message, command, "running")
        send_imessage(sender, f"Codex received and is running:\n{truncate_reply(command, 500)}", config)
        result = run_codex(command, sender, config)
        status = "completed" if int(result["exit_code"]) == 0 else "failed"
        summary = truncate_reply(str(result.get("summary") or "No Codex summary returned."), limit)
        record_message(state, message, command, status, int(result["exit_code"]), summary)
        prefix_text = "Codex completed." if status == "completed" else f"Codex failed with exit code {result['exit_code']}."
        send_imessage(sender, f"{prefix_text}\n\n{summary}", config)
    finally:
        lock.release()


def validate_config(config: Dict[str, Any]) -> None:
    required_paths = ["messages_db", "codex_path", "workspace_path"]
    for key in required_paths:
        path = Path(config[key]).expanduser()
        if not path.exists():
            raise FileNotFoundError(f"{key} does not exist: {path}")
    if not str(config.get("command_prefix", "")).strip():
        raise ValueError("command_prefix cannot be blank")


def run_once(config: Dict[str, Any], state: sqlite3.Connection) -> None:
    commands = fetch_new_commands(config, state)
    for message in commands:
        process_message(config, state, message)


def main() -> int:
    config_path = Path(os.environ.get("CODEX_IMESSAGE_RELAY_CONFIG", DEFAULT_CONFIG_PATH)).expanduser()
    config = ensure_config(config_path)
    setup_logging(config)
    logging.info("Starting iMessage Codex relay with config %s", config_path)
    validate_config(config)
    state = open_state(config)
    initialize_state_if_needed(state, config)

    if "--once" in sys.argv:
        run_once(config, state)
        return 0

    poll_seconds = max(1, int(config.get("poll_seconds") or 5))
    last_permission_warning_at = 0.0
    while not STOP:
        try:
            run_once(config, state)
        except (sqlite3.OperationalError, sqlite3.DatabaseError) as exc:
            if "authorization denied" in str(exc).lower():
                now = time.time()
                if now - last_permission_warning_at > 60:
                    logging.error(
                        "Messages DB read failed: authorization denied. Grant Full Disk Access to /Library/Developer/CommandLineTools/usr/bin/python3 or /usr/bin/python3, then restart the LaunchAgent."
                    )
                    last_permission_warning_at = now
            else:
                logging.exception("Messages DB read failed. Full Disk Access may be required: %s", exc)
        except Exception as exc:
            logging.exception("Relay loop failed: %s", exc)
        time.sleep(poll_seconds)
    logging.info("Stopping iMessage Codex relay")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
