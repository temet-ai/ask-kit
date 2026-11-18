# Security policy

ask-kit runs on your machine with your rights. It reads the transcripts your coding agents
write (which hold prompts, file contents and tool output) and the repository an agent works
in, and it sends excerpts of them to the model you chose as the investigator. It reads API keys
from where you told it they are, and runs the code in its domains, including shared domains you
add. The investigator acts in its domain: the code domain edits files, runs programs and uses
git in the repository it was asked about. A problem is a security problem when it sends
transcripts, code or keys anywhere other than the configured model provider, writes to another
agent's transcripts, exposes a stored key, or installs a shared domain without showing it first.

## Reporting a vulnerability

Report it privately through GitHub: on [temet-ai/ask-kit](https://github.com/temet-ai/ask-kit),
open the **Security** tab and choose **Report a vulnerability**. Please do not open a public
issue for it, and do not put real transcripts or keys in a report.

Say what you found, how to reproduce it, and which version (`npm ls -g ask-kit` shows it with the commit) and platform
you used. We aim to reply within a week. Fixes go on `main`; there are no patches to older
versions.

## Supported versions

Only the latest commit on `main` is supported.

## Keys

ask-kit's config records where a key is (an environment variable name or a file), not the key.
A key you paste during setup is written to `~/.config/ask-kit/keys.env` (Windows:
`%APPDATA%\ask-kit\keys.env`) with owner-only permissions, and is sent only to the provider it
belongs to.
