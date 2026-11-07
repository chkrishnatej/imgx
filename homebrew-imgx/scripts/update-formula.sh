#!/usr/bin/env bash
# Generate Formula/imgx.rb from the published release.
#
# The release workflow publishes checksums.txt next to the archives. This
# script reads it and fills in the template, so the formula's checksums always
# match the assets they point at.
#
#   ./scripts/update-formula.sh 1.0.0            # point at a published release
#   ./scripts/update-formula.sh --placeholder    # reset to the unreleased state
#
# Run it from the root of the tap repository.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <version>" >&2
  echo "example: $0 1.0.0" >&2
  exit 1
fi

repo="chkrishnatej/imgx"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template="$root/scripts/imgx.rb.template"
formula="$root/Formula/imgx.rb"

if [[ ! -f "$template" ]]; then
  echo "template not found at $template" >&2
  exit 1
fi

# Fills the template in and writes the formula.
render() {
  python3 - "$template" "$formula" "$@" <<'PY'
import pathlib
import sys

template_path, formula_path = sys.argv[1:3]
version = sys.argv[3]
values = {
    "{{VERSION}}": version,
    "{{DARWIN_ARM64_SHA}}": sys.argv[4],
    "{{DARWIN_X64_SHA}}": sys.argv[5],
    "{{LINUX_ARM64_SHA}}": sys.argv[6],
    "{{LINUX_X64_SHA}}": sys.argv[7],
}

text = pathlib.Path(template_path).read_text(encoding="utf-8")
for placeholder, value in values.items():
    text = text.replace(placeholder, value)

pathlib.Path(formula_path).write_text(text, encoding="utf-8")
PY
}

# The unreleased state: correct urls, checksums that cannot match any archive.
# Publishing this makes `brew install imgx` fail loudly instead of installing
# something that was never verified.
if [[ "$1" == "--placeholder" ]]; then
  render "0.0.0" \
    "REPLACE_DARWIN_ARM64_SHA" \
    "REPLACE_DARWIN_X64_SHA" \
    "REPLACE_LINUX_ARM64_SHA" \
    "REPLACE_LINUX_X64_SHA"
  echo "Formula/imgx.rb reset to the unreleased placeholder state."
  exit 0
fi

version="$1"
checksums="$(mktemp)"
trap 'rm -f "$checksums"' EXIT

# Overridable so the script can be tested against a local file.
base="${IMGX_RELEASE_BASE:-https://github.com/${repo}/releases/download/v${version}}"
url="${base}/checksums.txt"
echo "Fetching ${url}"
if ! curl -fsSL "$url" -o "$checksums"; then
  echo "Could not download ${url}" >&2
  echo "Publish the release first, then run this again." >&2
  exit 1
fi

sha_for() {
  local target="$1"
  local file="imgx-${version}-${target}.tar.gz"
  awk -v file="$file" '$2 == file { print $1 }' "$checksums"
}

targets=(darwin-arm64 darwin-x64 linux-arm64 linux-x64)
shas=()
missing=0
for target in "${targets[@]}"; do
  sum="$(sha_for "$target")"
  if [[ -z "$sum" ]]; then
    echo "No checksum for imgx-${version}-${target}.tar.gz in ${url}" >&2
    missing=1
  elif [[ ! "$sum" =~ ^[0-9a-f]{64}$ ]]; then
    echo "Checksum for imgx-${version}-${target}.tar.gz is not a sha256: ${sum}" >&2
    missing=1
  fi
  shas+=("$sum")
done
if [[ "$missing" -ne 0 ]]; then
  exit 1
fi

render "$version" "${shas[@]}"
echo "Formula/imgx.rb now points at v${version}"

echo
echo "Review and publish:"
echo "  git diff"
echo "  git commit -am 'imgx ${version}'"
echo "  git push"
