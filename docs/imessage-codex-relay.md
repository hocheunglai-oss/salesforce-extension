# iMessage Codex Relay

This local Mac relay lets allowlisted iMessages trigger Codex CLI work on this computer.

## Install

From the repo root:

```sh
scripts/install-imessage-codex-relay.sh
```

The installer creates:

- Config: `~/.codex-imessage-relay/config.json`
- Installed relay script: `~/.codex-imessage-relay/bin/imessage_codex_relay.py`
- State database: `~/.codex-imessage-relay/state.sqlite3`
- Logs: `~/.codex-imessage-relay/relay.log`
- LaunchAgent: `~/Library/LaunchAgents/com.vincex.codex-imessage-relay.plist`

## Configure Allowed Sender

Edit `~/.codex-imessage-relay/config.json` and add the iMessage sender handle:

```json
{
  "allowed_handles": ["your-email@example.com", "+85212345678"]
}
```

The relay refuses every command until at least one sender is allowlisted.

## Use

Send an iMessage from an allowlisted sender:

```text
codex run: check app health
```

Only messages starting with `codex run:` are processed. Other iMessages are ignored.

## Manage

Reload after editing config:

```sh
launchctl kickstart -k gui/$(id -u)/com.vincex.codex-imessage-relay
```

Stop:

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.vincex.codex-imessage-relay.plist
```

Start:

```sh
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.vincex.codex-imessage-relay.plist
```

## macOS Permissions

If the log says Messages DB access failed, grant Full Disk Access to the terminal/Codex process that installed or runs the LaunchAgent.

If replies fail, macOS may ask for Automation permission to control Messages. Allow it.

## Safety

- Sender must be allowlisted.
- Prefix must be `codex run:`.
- Duplicate message GUIDs are ignored.
- One Codex task runs at a time.
- Replies redact common token/password patterns.
- Codex runs with `--sandbox danger-full-access` and `--ask-for-approval never`; treat the allowlist as a high-trust control.
