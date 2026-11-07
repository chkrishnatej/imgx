# Homebrew tap for imgx

`imgx` converts images between common formats from the command line. It reads
SVG, PNG, JPEG, WebP, AVIF, TIFF, GIF, BMP, ICO, HEIC, PSD, PDF and camera raw,
and writes PNG, JPEG, WebP, AVIF or TIFF.

## Install

```bash
brew tap chkrishnatej/imgx
brew install imgx
```

## What you get

| Path | What |
|---|---|
| `$(brew --prefix)/bin/imgx` | The converter. |
| `$(brew --prefix)/share/man/man1/imgx.1` | The manual page, so `man imgx` works. |
| `$(brew --prefix)/share/zsh/site-functions/_imgx` | zsh completion, already on `$fpath`. |

## Update and remove

```bash
brew update
brew upgrade imgx

brew uninstall imgx
brew untap chkrishnatej/imgx
```

## Install the development version

`--HEAD` compiles from the `main` branch, which needs
[Bun](https://bun.sh):

```bash
brew install chkrishnatej/imgx --HEAD
```

## Notes

The `heic`, `heif`, `psd`, `pdf` and camera raw inputs are decoded through
macOS `sips` and are therefore unavailable on Linux. Everything else works
identically on both platforms.

## Releasing a new version

The source repository publishes one archive per platform as a GitHub release.
This tap downloads those archives directly, so `brew install imgx` needs no
toolchain.

> **The formula in this repository is not usable yet.** It carries placeholder
> checksums, because no release has been published yet. `brew install imgx`
> fails loudly with a 404 until the first release exists and the formula is
> updated. This is deliberate: the alternative is a formula that looks ready but
> has never verified anything.

To cut a release:

1. In the source repository, tag and push:

   ```bash
   git tag v1.1.0
   git push --tags
   ```

   The release workflow builds the archives and publishes `checksums.txt`
   alongside them.

2. In this repository, point the formula at the new release:

   ```bash
   ./scripts/update-formula.sh 1.1.0
   git commit -am 'imgx 1.1.0'
   git push
   ```

`update-formula.sh` reads `checksums.txt` from the release and fills in the
version, urls and sha256 values, so the checksums always match the archives
they point at. It refuses to write the formula if a checksum is missing or is
not a sha256.

To go back to the unreleased state:

```bash
./scripts/update-formula.sh --placeholder
```

## Formula layout

`Formula/imgx.rb` is generated from `scripts/imgx.rb.template`. Edit the
template, not the formula, so the two do not drift apart.
