# config-dir.sh — the one place the user config directory is resolved. Source it.
#
# Sets QA_CONFIG_DIR to ~/.config/qa-panel, or to ~/.config/claude-qa-manager (the
# plugin's former name) while only that one exists, and QA_CONFIG_DIR_LEGACY=true
# in that case so callers can say so. Nothing is moved: the token, the user config
# and the timing histories stay together wherever they already are, and an
# operator migrates with one `mv`.
#
# Do NOT resolve this path anywhere else. The token is the reason: init.sh stores
# it, preflight.sh publishes where to read it, and a disagreement between the two
# leaves an empty token, which posts round notes under the developer's identity
# (docs/CASE-STUDIES.md §self-approval-fallback).
#
# Deliberately NOT XDG-aware, for the same reason: Claude Code itself uses
# CLAUDE_CONFIG_DIR, not XDG, and every caller must land on the same directory.
QA_CONFIG_DIR_NEW="$HOME/.config/qa-panel"
QA_CONFIG_DIR="$QA_CONFIG_DIR_NEW"
QA_CONFIG_DIR_LEGACY=false
if [ ! -d "$QA_CONFIG_DIR" ] && [ -d "$HOME/.config/claude-qa-manager" ]; then
  QA_CONFIG_DIR="$HOME/.config/claude-qa-manager"
  QA_CONFIG_DIR_LEGACY=true
fi
