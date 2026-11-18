# ask-kit setup, the interactive terminal setup, in a throwaway home.
#
# Record from the repository root (needs vhs):
#   vhs docs/videos/setup.tape
#
# HOME, the XDG folders and every agent's transcript folder point at a fresh temporary directory
# holding only the repository's fixture transcripts, and the API key is a made-up one, so the
# clip shows nothing of anyone's own sessions, keys or config and installs nothing into their agents.
# The alias sends ask-kit's HTTP through a dead proxy, so no local model server (Ollama) is listed.

Output docs/videos/renders/setup.mp4
Output docs/videos/renders/setup.webm
Output docs/videos/renders/setup.gif

Require node

Set Shell "bash"
Set FontFamily "Adwaita Mono"
Set FontSize 20
Set LetterSpacing 0
Set Width 1600
Set Height 1000
Set Padding 36
Set Margin 0
Set WindowBar Colorful
Set BorderRadius 12
Set TypingSpeed 45ms
Set Theme { "name": "ask-kit", "background": "#16161a", "foreground": "#f2ead8", "cursor": "#e5352b", "selection": "#3a3a42", "black": "#16161a", "red": "#e5352b", "green": "#8fbf7f", "yellow": "#e0b45c", "blue": "#7fa7d9", "magenta": "#c48fd0", "cyan": "#7fc4c4", "white": "#f2ead8", "brightBlack": "#6f6b63", "brightRed": "#ff5a4f", "brightGreen": "#a8d898", "brightYellow": "#f0cc7c", "brightBlue": "#9cc0ee", "brightMagenta": "#d8a8e2", "brightCyan": "#9cdada", "brightWhite": "#ffffff" }

Hide
Type `R=$PWD; M=$HOME/.local/share/mise/installs; export PATH=$M/claude/latest:$M/copilot/latest:$M/codex/latest/bin:$(dirname $(command -v node)):/usr/local/bin:/usr/bin; export HOME=$(mktemp -d) && cd "$HOME" || exit 1; unset ASK_KIT_CONFIG ASK_KIT_STATE OPENCODE_DB XDG_DATA_HOME CLAUDE_CONFIG_DIR CODEX_HOME COPILOT_HOME GEMINI_CLI_HOME; export XDG_CONFIG_HOME=$HOME/.config XDG_STATE_HOME=$HOME/.local/state XDG_CACHE_HOME=$HOME/.cache`
Enter
Type `export OPENROUTER_API_KEY=sk-or-v1-demo0000000000000000000000000000 PS1='\[\e[38;2;229;53;43m\]❯\[\e[0m\] '`
Enter
Type `F=$R/test/fixtures; mkdir -p .claude .codex .copilot .gemini; cp -r $F/claude-code/projects .claude/; cp -r $F/codex/sessions .codex/; cp -r $F/copilot-cli/session-state .copilot/; cp -r $F/gemini-cli/tmp .gemini/`
Enter
Type `alias ask-kit="NODE_USE_ENV_PROXY=1 HTTP_PROXY=http://127.0.0.1:9 NO_PROXY= node $R/bin/ask-kit.mjs"`
Enter
Sleep 1s
Type "clear"
Enter
Sleep 300ms
Show

Sleep 600ms
Type "ask-kit setup"
Sleep 500ms
Enter
# Wait+Line looks at the cursor's line: the prompt of each question. (Wait+Screen only sees the top
# of a screen that has scrolled.)
Wait+Line@30s /for none\)/ 
Sleep 4s
Enter
Wait+Line@10s /for none\)/ 
Sleep 2s
Type "0"
Enter
Wait+Line@10s /a number, Enter for the suggested\)/ 
Sleep 6s
Enter
Wait+Line@10s /for none\)/ 
Sleep 3s
Enter
Wait+Line@10s /for none\)/ 
Sleep 3s
Enter
Wait+Line@10s /Go ahead\? \(y\/N\)/ 
Sleep 4s
Type "y"
Enter
Sleep 5s
