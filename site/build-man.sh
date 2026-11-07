#!/usr/bin/env bash
# Regenerate site/manual.html from man/imgx.1.
#
# mandoc renders the roff source to HTML; this script takes mandoc's rendered
# body and injects it into site/manual.template.html, so the website can never
# drift from the man page shipped in the package.
#
# Requires mandoc (macOS ships it, Debian/Ubuntu: apt install mandoc).

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v mandoc >/dev/null 2>&1; then
  echo "mandoc not found; install it or run this on macOS" >&2
  exit 1
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

mandoc -T html "$root/man/imgx.1" > "$tmp/raw.html"

python3 - "$root" "$tmp/raw.html" <<'PY'
import pathlib
import re
import sys

root = pathlib.Path(sys.argv[1])
raw = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")

start = raw.index('<div class="manual-text">') + len('<div class="manual-text">')
end = raw.index('</div>\n<table class="foot">')
body = raw[start:end].strip()

foot_html = re.search(r'<table class="foot">(.*?)</table>', raw, re.S).group(1)
foot = " ".join(re.sub(r"<[^>]+>", " ", foot_html).split())

version = re.search(r'"version": "([^"]+)"', (root / "package.json").read_text()).group(1)
date = re.search(r'^\.TH IMGX 1 "([^"]+)"', (root / "man/imgx.1").read_text(), re.M).group(1)

# The formats matrix is a plain roff table, so the yes/no cells carry no
# semantics of their own. Mark them here so the stylesheet can colour them.
def mark_cells(table_html):
    def replace(match):
        text = match.group(1)
        if text == "yes":
            css = "yes"
        elif text == "no":
            css = "no"
        elif text == "macOS":
            css = "macos"
        else:
            return match.group(0)
        return f'<td class="{css}">{text}</td>'

    return re.sub(r"<td><b>(yes|no|macOS)</b></td>", replace, table_html)

body = re.sub(r'<table class="tbl".*?</table>',
               lambda m: mark_cells(m.group(0)),
               body,
               flags=re.S)

template = (root / "site/manual.template.html").read_text(encoding="utf-8")
page = template.replace("{{BODY}}", body)
page = page.replace("{{VERSION}}", version).replace("{{DATE}}", date).replace("{{FOOT}}", foot)

(root / "site/manual.html").write_text(page, encoding="utf-8")
print(f"wrote {root / 'site/manual.html'}")
PY
