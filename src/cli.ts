#!/usr/bin/env bun
import { mkdir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import packageJson from "../package.json";
import {
  convert,
  extensionForFormat,
  formatFromExtension,
  OUTPUT_FORMATS,
  parseBackground,
  type ConvertOptions,
  type OutputFormat,
} from "./convert";
import { expandInputs, type InputFile } from "./inputs";

const HELP = `imgx - convert images from the terminal

Usage
  imgx <input...> [options]

  Inputs are files, directories (walked recursively) or globs.
  Without --out, files are written next to their source as png.

Options
  -o, --out <path>       Output file, or directory (created if missing,
                         with the input folder structure mirrored inside)
  -f, --format <fmt>     png | jpeg | webp | avif | tiff      [default: png]
  -w, --width <px>       Target width. SVGs render at exactly this size,
                         raster images are only ever shrunk
      --height <px>      Target height, ignored when --width is set
  -s, --scale <n>        SVG only: render at n times its intrinsic size
  -q, --quality <1-100>  Quality for jpeg, webp and avif       [default: 85]
      --background <css> Color behind JPEG transparency      [default: white]
                         #rrggbb, #rgb, rgb(r,g,b), or a name:
                         white black grey gray red green blue
      --overwrite        Replace existing files instead of skipping them
      --dry-run          Print what would be written, change nothing
  -h, --help             Show this help
      --version          Show the version

Formats
  reads   svg png jpg jpeg webp avif tif tiff gif bmp ico tga pnm,
          plus heic heif psd pdf and camera raw through macOS sips
  writes  png jpeg webp avif tiff

  Rasters are never enlarged. Animated gif and webp use their first
  frame. There is no svg output: rasterizing a photo to vectors never
  returns the original curves.

Behavior
  A --out path ending in an image extension names the output file;
  anything else is a directory and gets created. Existing files are
  skipped, never replaced, unless --overwrite is given. The exit status
  is 1 if any file fails.

Examples
  imgx diagram.svg -w 2400
  imgx hero.webp -f png -o images/
  imgx screenshots/ -f webp -q 90 -o build/webp
  imgx "shots/*.png" -w 1280 -o resized
  imgx photo.heic -f jpeg -q 95 -o print/

Full manual: man imgx`;

interface CliOptions extends ConvertOptions {
  out?: string;
  overwrite: boolean;
  dryRun: boolean;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      format: { type: "string", short: "f" },
      width: { type: "string", short: "w" },
      height: { type: "string" },
      scale: { type: "string", short: "s" },
      quality: { type: "string", short: "q" },
      background: { type: "string" },
      overwrite: { type: "boolean" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean" },
    },
  });

  if (values.help) {
    console.log(HELP);
    return 0;
  }

  if (values.version) {
    console.log(packageJson.version);
    return 0;
  }

  if (positionals.length === 0) {
    console.error("imgx: no input given\n");
    console.log(HELP);
    return 1;
  }

  const exclude = values.out === undefined ? undefined : resolve(values.out);
  const inputs = await expandInputs(positionals, { exclude });
  if (inputs.length === 0) {
    console.error("imgx: no convertible files found");
    return 1;
  }

  const format = resolveFormat(values.format, values.out);
  const background = values.background ?? "#ffffff";
  parseBackground(background);
  const options: CliOptions = {
    format,
    width: positiveNumber(values.width, "--width"),
    height: positiveNumber(values.height, "--height"),
    scale: positiveNumber(values.scale, "--scale"),
    quality: resolveQuality(values.quality),
    background,
    out: values.out,
    overwrite: values.overwrite ?? false,
    dryRun: values["dry-run"] ?? false,
  };

  const jobs = await resolveOutputs(inputs, options);
  return runConversions(jobs, options);
}

function resolveFormat(explicit: string | undefined, out: string | undefined): OutputFormat {
  if (explicit !== undefined) {
    if (!OUTPUT_FORMATS.includes(explicit as OutputFormat)) {
      throw new Error(`unsupported --format "${explicit}", pick one of ${OUTPUT_FORMATS.join(", ")}`);
    }
    return explicit as OutputFormat;
  }

  if (out !== undefined) {
    const inferred = formatFromExtension(out);
    if (inferred !== undefined) return inferred;
  }

  return "png";
}

function resolveQuality(value: string | undefined): number {
  if (value === undefined) return 85;
  const quality = Number(value);
  if (!Number.isInteger(quality) || quality < 1 || quality > 100) {
    throw new Error(`--quality must be a whole number from 1 to 100, got "${value}"`);
  }
  return quality;
}

function positiveNumber(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive number, got "${value}"`);
  }
  return parsed;
}

interface ConversionJob {
  input: InputFile;
  output: string;
}

async function resolveOutputs(inputs: InputFile[], options: CliOptions): Promise<ConversionJob[]> {
  const extension = extensionForFormat(options.format);

  if (options.out === undefined) {
    return inputs.map((input) => ({
      input,
      output: replaceExtension(join(dirname(input.path), basename(input.path)), extension),
    }));
  }

  const requested = resolve(options.out);

  if (inputs.length > 1 && formatFromExtension(requested) !== undefined) {
    throw new Error(`--out "${options.out}" looks like a file, pass a directory when converting ${inputs.length} files`);
  }

  // A path with an image extension names the output file. Anything else is a directory
  // that gets created, and the input folder structure is mirrored inside it.
  const isFile = inputs.length === 1 && formatFromExtension(requested) !== undefined;
  if (isFile) {
    const implied = formatFromExtension(requested)!;
    if (implied !== options.format) {
      throw new Error(`--out "${options.out}" implies ${implied} but --format is ${options.format}`);
    }
    return [{ input: inputs[0], output: replaceExtension(requested, extension) }];
  }

  return inputs.map((input) => ({
    input,
    output: replaceExtension(join(requested, input.relativePath), extension),
  }));
}

async function runConversions(jobs: ConversionJob[], options: CliOptions): Promise<number> {
  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of jobs) {
    const source = displayPath(job.input.path);
    const destination = displayPath(job.output);

    if (!options.overwrite && (await exists(job.output))) {
      skipped += 1;
      console.log(`skip  ${source} -> ${destination} (exists, pass --overwrite)`);
      continue;
    }

    if (options.dryRun) {
      console.log(`plan  ${source} -> ${destination}`);
      continue;
    }

    try {
      await mkdir(dirname(job.output), { recursive: true });
      const result = await convert(job.input.path, job.output, options);
      converted += 1;
      console.log(
        `ok    ${source} -> ${destination}  ${result.width}x${result.height}  ${formatBytes(result.bytes)}`,
      );
    } catch (error) {
      failed += 1;
      console.error(`fail  ${source}  ${(error as Error).message}`);
    }
  }

  if (options.dryRun) {
    console.log(`\n${jobs.length} file(s) would be written`);
    return 0;
  }

  const summary = [`${converted} converted`];
  if (skipped > 0) summary.push(`${skipped} skipped`);
  if (failed > 0) summary.push(`${failed} failed`);
  console.log(`\n${summary.join(", ")}`);

  return failed > 0 ? 1 : 0;
}

function replaceExtension(path: string, extension: string): string {
  const current = extname(path);
  return current === "" ? `${path}.${extension}` : `${path.slice(0, -current.length)}.${extension}`;
}

function displayPath(path: string): string {
  const shortened = relative(process.cwd(), path);
  return shortened.startsWith("..") ? path : shortened;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

try {
  process.exit(await main());
} catch (error) {
  console.error(`imgx: ${(error as Error).message}`);
  process.exit(1);
}
