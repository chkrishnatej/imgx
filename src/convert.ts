#!/usr/bin/env bun
import { ResizeFilterType, ResizeFit, Transformer } from "@napi-rs/image";
import { Resvg } from "@resvg/resvg-js";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

export type OutputFormat = "png" | "jpeg" | "webp" | "avif" | "tiff";

export const OUTPUT_FORMATS: OutputFormat[] = ["png", "jpeg", "webp", "avif", "tiff"];

const EXTENSION_TO_FORMAT: Record<string, OutputFormat> = {
  png: "png",
  jpg: "jpeg",
  jpeg: "jpeg",
  jpe: "jpeg",
  webp: "webp",
  avif: "avif",
  tif: "tiff",
  tiff: "tiff",
};

const FORMAT_TO_EXTENSION: Record<OutputFormat, string> = {
  png: "png",
  jpeg: "jpg",
  webp: "webp",
  avif: "avif",
  tiff: "tiff",
};

export function formatFromExtension(path: string): OutputFormat | undefined {
  return EXTENSION_TO_FORMAT[extname(path).slice(1).toLowerCase()];
}

export function extensionForFormat(format: OutputFormat): string {
  return FORMAT_TO_EXTENSION[format];
}

export function isSvg(path: string): boolean {
  return extname(path).toLowerCase() === ".svg";
}

export interface ConvertOptions {
  format: OutputFormat;
  width?: number;
  height?: number;
  scale?: number;
  quality: number;
  background: string;
}

export interface ConvertResult {
  width: number;
  height: number;
  bytes: number;
}

export async function convert(
  inputPath: string,
  outputPath: string,
  options: ConvertOptions,
): Promise<ConvertResult> {
  const encoded = isSvg(inputPath) ? await encodeSvg(inputPath, options) : await encodeRaster(inputPath, options);
  await writeFile(outputPath, encoded.data);
  return { width: encoded.width, height: encoded.height, bytes: encoded.data.length };
}

interface EncodedImage {
  data: Buffer;
  width: number;
  height: number;
}

// SVG is rasterized by resvg directly at the target size, so it stays vector-sharp.
// Every other format is decoded to pixels first and then resized with Lanczos3.
async function encodeSvg(inputPath: string, options: ConvertOptions): Promise<EncodedImage> {
  const svg = await readFile(inputPath, "utf8");
  const fitTo =
    options.width !== undefined
      ? { mode: "width" as const, value: options.width }
      : options.height !== undefined
        ? { mode: "height" as const, value: options.height }
        : options.scale !== undefined
          ? { mode: "zoom" as const, value: options.scale }
          : { mode: "original" as const };

  const rendered = new Resvg(svg, { fitTo }).render();
  const data = await encode(new Transformer(rendered.asPng()), options);
  return { data, width: rendered.width, height: rendered.height };
}

async function encodeRaster(inputPath: string, options: ConvertOptions): Promise<EncodedImage> {
  const decoded = await decodeRaster(inputPath);
  const dimensions = targetDimensions(decoded.width, decoded.height, options);
  const image =
    dimensions.width === decoded.width && dimensions.height === decoded.height
      ? decoded.image
      : decoded.image.resize({
          width: dimensions.width,
          height: dimensions.height,
          filter: ResizeFilterType.Lanczos3,
          fit: ResizeFit.Inside,
        });

  return { data: await encode(image, options), width: dimensions.width, height: dimensions.height };
}

interface DecodedImage {
  image: Transformer;
  width: number;
  height: number;
}

async function decodeRaster(inputPath: string): Promise<DecodedImage> {
  try {
    const image = new Transformer(await readFile(inputPath));
    const meta = await image.metadata();
    return { image, width: meta.width, height: meta.height };
  } catch {
    // @napi-rs/image covers png, jpeg, webp, avif, tiff, gif, bmp, ico, tga and pnm.
    // HEIC, PSD, PDF and camera raw are left to macOS ImageIO through sips.
    const image = new Transformer(await decodeWithSips(inputPath));
    const meta = await image.metadata();
    return { image, width: meta.width, height: meta.height };
  }
}

async function decodeWithSips(inputPath: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "imgx-"));
  try {
    const target = join(directory, "decoded.png");
    const process = Bun.spawn(["sips", "-s", "format", "png", inputPath, "--out", target], {
      stdout: "ignore",
      stderr: "ignore",
    });
    if ((await process.exited) !== 0) {
      throw new Error(`cannot decode ${inputPath}: unsupported format${sipsHint()}`);
    }
    return await readFile(target);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function sipsHint(): string {
  return process.platform === "darwin" ? "" : " (the sips fallback needs macOS)";
}

interface Dimensions {
  width: number;
  height: number;
}

// Rasters are never upscaled: re-encoding a small image larger only adds bytes.
function targetDimensions(width: number, height: number, options: ConvertOptions): Dimensions {
  if (options.width === undefined && options.height === undefined) return { width, height };

  const targetWidth = options.width ?? Math.round((width * options.height!) / height);
  const targetHeight = options.height ?? Math.round((height * options.width!) / width);

  return targetWidth >= width || targetHeight >= height ? { width, height } : { width: targetWidth, height: targetHeight };
}

async function encode(image: Transformer, options: ConvertOptions): Promise<Buffer> {
  switch (options.format) {
    case "png":
      return image.png();
    case "webp":
      return image.webp(options.quality);
    case "avif":
      return image.avif({ quality: options.quality, alphaQuality: options.quality });
    case "tiff":
      return image.tiff();
    case "jpeg":
      return (await flatten(image, options.background)).jpeg(options.quality);
  }
}

// JPEG has no alpha channel, so transparent pixels must be composited onto a solid color
// first. Skipping this leaves whatever RGB sat underneath the transparency in the output.
async function flatten(image: Transformer, background: string): Promise<Transformer> {
  const pixels = await image.png();
  const meta = await new Transformer(pixels).metadata();
  const backgroundPixels = repeatPixel(parseBackground(background), meta.width, meta.height);
  return Transformer.fromRgbaPixels(backgroundPixels, meta.width, meta.height).overlay(pixels, 0, 0);
}

const NAMED_BACKGROUNDS: Record<string, RGB> = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
};

type RGB = [number, number, number];

// Deliberately strict: a typo in the color must fail loudly instead of quietly
// painting the JPEG black, which is what SVG paint parsers fall back to.
export function parseBackground(css: string): RGB {
  const value = css.trim().toLowerCase();

  const named = NAMED_BACKGROUNDS[value];
  if (named !== undefined) return named;

  const hex = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hex !== null) {
    const digits = hex[1];
    const pairs =
      digits.length === 3 || digits.length === 4
        ? [0, 1, 2].map((index) => digits[index].repeat(2))
        : digits.length === 6 || digits.length === 8
          ? [0, 2, 4].map((index) => digits.slice(index, index + 2))
          : [];
    if (pairs.length === 3) return pairs.map((pair) => parseInt(pair, 16)) as RGB;
  }

  const rgb = /^rgba?\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})/.exec(value);
  if (rgb !== null) {
    const channels = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    if (channels.every((channel) => channel <= 255)) return channels as RGB;
  }

  throw new Error(`cannot parse --background "${css}", use #rrggbb, rgb(r,g,b) or a name like white`);
}

function repeatPixel(color: RGB, width: number, height: number): Buffer {
  const pixel = Buffer.from([color[0], color[1], color[2], 255]);
  const channels = Buffer.alloc(width * height * 4);
  for (let offset = 0; offset < channels.length; offset += 4) pixel.copy(channels, offset);
  return channels;
}
