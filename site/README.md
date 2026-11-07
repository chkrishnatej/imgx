# Website

The static site for `imgx`. Three pages, no build step, no dependencies.

| File | What |
|---|---|
| `index.html` | Landing page: install, usage, examples, formats, the Homebrew tap. |
| `help.html` | CLI reference: every flag, the output contract, zsh completion. |
| `manual.html` | The `imgx(1)` manual page, rendered from `man/imgx.1`. |
| `manual.template.html` | The template `manual.html` is generated from. |
| `build-man.sh` | Regenerates `manual.html` from `man/imgx.1`. |
| `assets/style.css` | The stylesheet, shared by all three pages. |

## Deploying

The site is plain HTML and CSS, so any static host works: GitHub Pages,
Cloudflare Pages, Netlify, S3, or `python3 -m http.server` for a quick look.

To publish it from this repository with GitHub Pages, serve the `site`
directory and set it as the Pages source in the repository settings.

## Regenerating the manual page

`manual.html` is generated from `man/imgx.1` so the website can never drift
from the manual page that ships with the package. After editing the roff
source:

```bash
./site/build-man.sh
```

It needs [mandoc](https://mandoc.bsd.lv): macOS ships it, on Debian and
Ubuntu install it with `apt install mandoc`.

The help text on `help.html` is a copy of `imgx --help`. If the CLI changes,
update that block by hand:

```bash
bun run src/cli.ts --help
```

## The formats matrix

The matrix on `index.html` and `help.html` and the table in the man page
describe the same thing. `man/imgx.1` is the source of truth, and
`test/formats.test.ts` fails if the three ever drift apart, so edit all three
together — or edit the man page and rerun `build-man.sh`.

## Checking it locally

```bash
python3 -m http.server 8000 --directory site
```
