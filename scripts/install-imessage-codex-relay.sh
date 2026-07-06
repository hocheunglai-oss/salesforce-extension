#!/bin/sh
set -eu

REPO_DIR="/Users/vincex/Documents/SF Extension/Salesforce-Extension"
SCRIPT="$REPO_DIR/scripts/imessage_codex_relay.py"
PYTHON="/usr/bin/python3"
CONFIG_DIR="$HOME/.codex-imessage-relay"
INSTALL_DIR="$CONFIG_DIR/bin"
INSTALLED_SCRIPT="$INSTALL_DIR/imessage_codex_relay.py"
CONFIG="$CONFIG_DIR/config.json"
PLIST="$HOME/Library/LaunchAgents/com.vincex.codex-imessage-relay.plist"
LABEL="com.vincex.codex-imessage-relay"
GUI_DOMAIN="gui/$(id -u)"

mkdir -p "$CONFIG_DIR" "$INSTALL_DIR" "$HOME/Library/LaunchAgents"

if [ ! -f "$SCRIPT" ]; then
  echo "Relay script not found: $SCRIPT" >&2
  exit 1
fi

cp "$SCRIPT" "$INSTALLED_SCRIPT"
chmod 700 "$INSTALLED_SCRIPT"

# Creates default config/state if needed and initializes from latest message,
# so old matching iMessages are not processed on first launch.
"$PYTHON" "$INSTALLED_SCRIPT" --once

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$PYTHON</string>
    <string>$INSTALLED_SCRIPT</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>$REPO_DIR</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>CODEX_IMESSAGE_RELAY_CONFIG</key>
    <string>$CONFIG</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$CONFIG_DIR/launchd.out.log</string>
  <key>StandardErrorPath</key>
  <string>$CONFIG_DIR/launchd.err.log</string>
</dict>
</plist>
EOF

chmod 600 "$PLIST"
plutil -lint "$PLIST"

launchctl bootout "$GUI_DOMAIN" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "$GUI_DOMAIN" "$PLIST"
launchctl kickstart -k "$GUI_DOMAIN/$LABEL"

cat <<EOF
iMessage Codex relay installed.

Config:
  $CONFIG

LaunchAgent:
  $PLIST

Important:
  1. Add your iMessage sender handle to allowed_handles in the config.
  2. Grant Full Disk Access to Terminal/Codex if chat.db cannot be read under LaunchAgent.
  3. Grant Automation permission when macOS asks to let Python/osascript control Messages.
  4. Send commands using: codex run: <your request>

Logs:
  $CONFIG_DIR/relay.log
  $CONFIG_DIR/launchd.out.log
  $CONFIG_DIR/launchd.err.log
EOF
