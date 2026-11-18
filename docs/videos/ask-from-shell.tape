# ask-kit asked from the shell, against this repository's code.
#
# Record from the repository root (needs vhs, and OPENROUTER_API_KEY for the investigator):
#   vhs docs/videos/ask-from-shell.tape
#
# It uses a throwaway config (code domain only, see demo-answers.json), so the clip never
# shows anyone's own session transcripts and installs nothing into their agents.

Output docs/videos/renders/ask-from-shell.mp4
Output docs/videos/renders/ask-from-shell.webm
Output docs/videos/renders/ask-from-shell.gif

Require node

Set Shell "bash"
Set FontFamily "Adwaita Mono"
Set FontSize 20
Set LetterSpacing 0
Set Width 1600
Set Height 900
Set Padding 36
Set Margin 0
Set WindowBar Colorful
Set BorderRadius 12
Set TypingSpeed 45ms
Set Theme { "name": "ask-kit", "background": "#16161a", "foreground": "#f2ead8", "cursor": "#e5352b", "selection": "#3a3a42", "black": "#16161a", "red": "#e5352b", "green": "#8fbf7f", "yellow": "#e0b45c", "blue": "#7fa7d9", "magenta": "#c48fd0", "cyan": "#7fc4c4", "white": "#f2ead8", "brightBlack": "#6f6b63", "brightRed": "#ff5a4f", "brightGreen": "#a8d898", "brightYellow": "#f0cc7c", "brightBlue": "#9cc0ee", "brightMagenta": "#d8a8e2", "brightCyan": "#9cdada", "brightWhite": "#ffffff" }

Hide
Type `export ASK_KIT_CONFIG=$(mktemp -d) ASK_KIT_STATE=$(mktemp -d) PS1='\[\e[38;2;229;53;43m\]❯\[\e[0m\] '`
Enter
Type `alias ask-kit="node $PWD/bin/ask-kit.mjs"`
Enter
Type `ask-kit apply docs/videos/demo-answers.json >/dev/null`
Enter
Sleep 1.5s
Type "clear"
Enter
Sleep 300ms
Show

Sleep 600ms
Type `ask-kit ask --domain code "how does ask-kit find Codex transcripts on disk?"`
Sleep 500ms
Enter

# The investigator digs in its own context; wait for the cost line that ends every answer.
Wait+Screen@90s /\$0\.\d+\]/
Sleep 4s

# Clear first, so only the follow-up's own cost line can satisfy the next Wait.
Type "clear"
Enter
Sleep 400ms
Type `ask-kit ask --domain code --continue "and where is that adapter registered?"`
Sleep 500ms
Enter
Wait+Screen@90s /\$0\.\d+\]/
Sleep 4s
