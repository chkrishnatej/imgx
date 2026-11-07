import { Glob } from "bun";
import { stat } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

export interface InputFile {
  /** Absolute path on disk. */
  path: string;
  /** Path relative to the directory the file was discovered in, used to mirror folders under --out. */
  relativePath: string;
}

const DISCOVERABLE_EXTENSIONS = new Set([
  "svg", "png", "jpg", "jpeg", "jpe", "webp", "avif", "tif", "tiff",
  "gif", "bmp", "ico", "tga", "pnm", "ppm", "pgm", "pbm",
  "heic", "heif", "psd", "pdf",
  "dng", "cr2", "cr3", "nef", "nrw", "arw", "raf", "orf", "rw2", "pef", "srw",
]);

const GLOB_CHARACTERS = /[*?[{]/;

export interface ExpandOptions {
  /**
   * Destination directory. Skipped while walking so a second run never picks up
   * files the first run wrote, e.g. `imgx . -o build`.
   */
  exclude?: string;
}

export async function expandInputs(patterns: string[], options: ExpandOptions = {}): Promise<InputFile[]> {
  const found = new Map<string, InputFile>();

  for (const pattern of patterns) {
    if (GLOB_CHARACTERS.test(pattern)) {
      const root = globRoot(pattern);
      for (const match of discover(root, options.exclude)) {
        found.set(match.path, match);
      }
      continue;
    }

    const absolute = resolve(pattern);
    const info = await statOrNull(absolute);

    if (info === null) throw new Error(`no such file or directory: ${pattern}`);

    if (info.isDirectory()) {
      for (const match of discover(absolute, options.exclude)) {
        found.set(match.path, match);
      }
      continue;
    }

    found.set(absolute, { path: absolute, relativePath: basename(absolute) });
  }

  return [...found.values()];
}

function discover(root: string, exclude: string | undefined): InputFile[] {
  const skip = exclude !== undefined && isInside(root, exclude) ? exclude : undefined;

  return [...new Glob("**/*").scanSync({ cwd: root, absolute: true })]
    .sort()
    .filter((match) => isDiscoverable(match))
    .filter((match) => skip === undefined || !isInside(skip, match))
    .map((match) => ({ path: match, relativePath: relative(root, match) }));
}

// The directory the glob pattern starts from, so `shots/*.png` mirrors as
// `out/a.png` instead of `out/shots/a.png`.
function globRoot(pattern: string): string {
  const absolute = resolve(pattern);
  const prefix = absolute.slice(0, absolute.search(GLOB_CHARACTERS));
  return prefix.endsWith("/") ? prefix : dirname(prefix);
}

function isInside(parent: string, child: string): boolean {
  return child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function isDiscoverable(path: string): boolean {
  return DISCOVERABLE_EXTENSIONS.has(extname(path).slice(1).toLowerCase());
}

async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}
