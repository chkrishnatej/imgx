# imgx

Convert images from the terminal. Five output formats, the inputs you actually have, no ImageMagick.

```bash
imgx diagram.svg -w 2400
# ok    diagram.svg -> diagram.png  2400x1200  84.2 KB
```

## Install

### Homebrew

```bash
brew tap chkrishnatej/imgx
brew install imgx
```

Installs the binary, the manual page and the zsh completion. macOS and Linux.

### From source

Requires [Bun](https://bun.sh) (built and tested on 1.4.4, macOS 26).

```bash
cd ~/Developer/imgx
bun install
bun link
```

`bun link` puts `imgx` on your `PATH` through `~/.bun/bin`. Remove it with `bun unlink -g imgx`.

The manual page:

```bash
ln -sf ~/Developer/imgx/man/imgx.1 /opt/homebrew/share/man/man1/imgx.1
man imgx
```

`/opt/homebrew/share/man` is already on `manpath`, so no shell config changes. For a non-terminal reader, `man imgx | col -b` strips the overstrike formatting.

A website with the same content lives in [`site/`](site/README.md).

## Usage

```
imgx <input...> [options]

  Inputs are files, directories (walked recursively) or globs.
  Without --out, files are written next to their source as png.

  -o, --out <path>       Output file, or directory (created if missing)
  -f, --format <fmt>     png | jpeg | webp | avif | tiff          [default: png]
  -w, --width <px>       Target width. SVGs render at exactly this size,
                         raster images are only ever shrunk
      --height <px>      Target height, ignored when --width is set
  -s, --scale <n>        SVG only: render at n times its intrinsic size
  -q, --quality <1-100>  Quality for jpeg, webp and avif           [default: 85]
      --background <css> Background used for JPEG transparency      [default: #ffffff]
      --overwrite        Replace files that already exist
      --dry-run          Print what would be written
```

### Examples

```bash
# a 1200px-wide PNG for a blog post
imgx hero.svg -w 1200

# the format nothing on macOS writes: webp
imgx screenshot.png -f webp -q 90 -o images/

# a whole folder, mirrored into a build directory that does not exist yet
imgx screenshots/ -f webp -q 90 -o build/webp

# one file out of many, to an exact name
imgx logo.svg -o static/logo-2x.png

# retina export of a diagram
imgx architecture.svg -s 2 -o static/

# see what would happen first
imgx "static/**/*.png" -f avif --dry-run
```

### Where files land

`--out` is a directory unless it ends in an image extension (`-o build/`, `-o build`, `-o logo.png` all do the obvious thing). Directories are created, including missing parents. When the input is a directory, the folder structure inside it is mirrored under `--out`:

```bash
imgx shots/ -o build
# shots/a.png   -> build/a.png
# shots/v2/b.svg -> build/v2/b.png
```

Existing files are skipped, not overwritten, unless you pass `--overwrite`. The run ends with a count and exits non-zero if anything failed.

## Automation

`imgx` is safe to call from a script or an agent: it never prompts, never opens a pager, and never needs a TTY.

- One line per file on stdout: `status  source -> destination  WxH  size`, where status is `ok`, `skip`, `plan` or `fail`.
- Failures go to stderr with the reason, so stdout stays parseable.
- Exit `0` when every file converted or was skipped, `1` when anything failed or the arguments were rejected.
- Re-running is idempotent: existing outputs are skipped, so a retry after a partial failure only redoes the unfinished work.
- `--dry-run` resolves inputs, destinations and formats without writing.

`man imgx` documents the same contract, plus the limits worth knowing before you point it at a directory of photographs.

## Shell completion

zsh only, for now. The completion knows the five formats, every flag, and only offers files `imgx` can actually read:

```bash
ln -s ~/Developer/imgx/completions/_imgx ~/.oh-my-zsh/custom/completions/_imgx
```

`~/.oh-my-zsh/custom/completions` is already on your `$fpath`, and oh-my-zsh owns `compinit`, so no `.zshrc` change is needed. Completion functions are indexed when the shell starts — **open a new shell**. If `imgx <TAB>` stays silent afterwards, clear the cache once:

```bash
rm -f ~/.zcompdump*   # then open a new shell
```

Homebrew installs the completion into `share/zsh/site-functions`, which is already on `$fpath`, so nothing to do there.

What each position suggests:

| Typed | Suggests |
|---|---|
| `imgx <TAB>` | only `svg png jpg jpeg webp avif tif tiff gif bmp ico tga heic heif psd pdf`, not every file in the directory |
| `imgx a.svg -f <TAB>` | `png jpeg webp avif tiff` |
| `imgx a.svg --<TAB>` | every flag with its one-line description |
| `imgx a.svg --background <TAB>` | `white black grey gray red green blue` |
| `imgx a.svg -o <TAB>` | files and directories, since `-o` accepts either |

Numeric flags (`-w`, `--height`, `-q`, `-s`) deliberately complete nothing — there is no useful set of widths to guess at.

bash and fish are not shipped. Say the word if you need them and I'll add the equivalents.

## Formats

One row per format. The **Read** column lists the formats that can be used as an input, the **Write** column the ones that can be an output.

| Format | Extension | Read | Write | Notes |
|---|---|---|---|---|
| `svg` | `.svg` | yes | no | Rasterized with [resvg](https://github.com/thx/resvg-js), so `-w`/`-s` produce genuinely sharp vectors at any size. |
| `png` | `.png` | yes | yes | Lossless, keeps transparency. The default output. |
| `jpeg` | `.jpg` | yes | yes | Lossy. Transparency is flattened onto `--background`. |
| `webp` | `.webp` | yes | yes | Lossy, keeps transparency, much smaller than PNG. |
| `avif` | `.avif` | yes | yes | Lossy, keeps transparency, smallest of the lot, slowest to encode. |
| `tiff` | `.tiff` | yes | yes | Lossless, uncompressed-ish, for print and archival. |
| `gif` | `.gif` | yes | no | First frame only. |
| `bmp` | `.bmp` | yes | no | Decoded natively. |
| `ico` | `.ico` | yes | no | Decoded natively. |
| `tga` | `.tga` | yes | no | Decoded natively. |
| `pnm` | `.pnm` | yes | no | Decoded natively. |
| `heic` | `.heic` | macOS | no | Decoded through `sips`, then converted as usual. |
| `heif` | `.heif` | macOS | no | Decoded through `sips`, then converted as usual. |
| `psd` | `.psd` | macOS | no | Decoded through `sips`, then converted as usual. |
| `pdf` | `.pdf` | macOS | no | Decoded through `sips`, then converted as usual. |
| camera raw | `.dng`, `.cr2`, `.nef`, … | macOS | no | Decoded through `sips`, then converted as usual. |

There is no SVG output. Vectorizing a raster image is a different problem, and the result is never the original vector.

## How it works

- **SVG** is parsed and rasterized by resvg at the exact target size. The SVG's own resolution never limits the output, and no resampling blur is introduced.
- **Rasters** are decoded and resized by [image-rs](https://github.com/image-rs/image) with a Lanczos3 filter, then encoded. Resizing happens on pixels, so rasters are never enlarged by `--width`; that would only add bytes.
- **HEIC, PSD, PDF and raw** are handed to macOS `sips` for decoding only. Encoding always goes through the same path.

Quality defaults to 85 for jpeg, webp and avif. On a typical screenshot, 85 vs 95 is roughly half the file size for no visible difference at 1x.

## Development

```bash
bun test           # 30 tests: conversion matrix, folder mirroring, overwrite, errors
bun run typecheck
```

`@napi-rs/image` is used instead of `sharp` on purpose: `sharp`'s native thread pool deadlocks under Bun 1.4.4, and `@napi-rs/image` is a plain N-API module that does not.
