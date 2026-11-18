# Videos

Clips for the ask-kit article on temet.ai and for the user guide. Each one is made from a source
in this folder by one command, so it can be made again when the product changes. Renders land in
`renders/` (not committed): an `.mp4`, a `.webm` and a `.poster.png` for each, plus a `.gif` for
the terminal clips. Upload them to the CMS from there.

| Clip | What it shows | Source |
|---|---|---|
| `ask-kit-hero` | The screen at the top of the temet.ai post, played: the benchmark's Karabiner ask typed, the investigator working, then the post's answer word for word. 1280×800 (16:10, as the site's screen slot); the site takes the `.gif` | HyperFrames (`hero/`); `.gif` with `ffmpeg -i ask-kit-hero.mp4 -vf "fps=15,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" ask-kit-hero.gif` |
| `how-an-ask-works` | The diagram in `docs/user-guide/images/how-an-ask-works.svg`, animated, ending on the benchmark's 391 / 10,000 tokens per session question | HyperFrames |
| `context-over-21-questions` | Context added to the calling agent over the 21 benchmark questions, question by question: ask on glm-5.3-flash against Sonnet 5.5 with Read, Grep and Bash (8,363 / 225,662), then the medians | HyperFrames |
| `four-calls-one-program` | One step done two ways: four tool calls, and the program from `how-it-works.md` run as one cell | HyperFrames |
| `backends-by-score` | Session-question scores per backend, with time or cost as RESULTS.md gives them | HyperFrames |
| `domains` | A question reaching the router, which picks the code domain, and that domain's folder | HyperFrames |
| `ask-from-shell` | `ask-kit ask` from the shell on this repository's code, then a follow-up with `--continue` | VHS tape |
| `setup` | `ask-kit setup` in a throwaway home: the agents it finds and the model question | VHS tape |

## Making them

From the repository root:

```sh
# a HyperFrames clip (check first; it also lints)
cd docs/videos/<clip> && npx hyperframes check && npx hyperframes render --quality looks --output ../renders/<clip>.mp4

# a terminal clip (needs vhs; ask-from-shell also needs OPENROUTER_API_KEY)
vhs docs/videos/<clip>.tape

# webm and poster, for any clip
cd docs/videos/renders
ffmpeg -i <clip>.mp4 -c:v libvpx-vp9 -crf 34 -b:v 0 -an <clip>.webm
ffmpeg -sseof -1 -i <clip>.mp4 -frames:v 1 <clip>.poster.png
```

`npx hyperframes preview` in a clip's folder opens it in a browser to edit.

## Rules the clips follow

- Text on screen names what is on screen (the temet.ai copy notes,
  `temet-ai/site/COPY.md`): no slogans, no "X, not Y" formulas.
- Numbers come from `bench/RESULTS.md` and `bench/results/` only. Each composition says in a
  comment where its numbers come from.
- No private data. The terminal clips run on a throwaway config (`demo-answers.json`: the code
  domain on this repository) or a throwaway home, so no one's own sessions, keys or accounts show.
- The palette is the logo's: `#16161a`, `#f2ead8`, `#e5352b`. Clips are silent, made to loop muted.

The terminal clips ask a live investigator, so the answer's wording changes a little each time.

## Embedding

```html
<video autoplay muted loop playsinline preload="metadata" poster="context-over-21-questions.poster.png"
       width="1920" height="1080" style="width:100%;height:auto;border-radius:12px">
  <source src="context-over-21-questions.webm" type="video/webm">
  <source src="context-over-21-questions.mp4" type="video/mp4">
</video>
```

Autoplay needs `muted`; `playsinline` keeps iOS from going full screen. On GitHub a committed
`.mp4` does not play: use a terminal clip's `.gif`, or drag the `.mp4` into the editor.
