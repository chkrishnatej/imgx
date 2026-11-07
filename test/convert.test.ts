import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Transformer } from "@napi-rs/image";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { convert, formatFromExtension, parseBackground, type ConvertOptions } from "../src/convert";

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60" viewBox="0 0 120 60">
  <rect width="120" height="60" fill="#0088ff"/>
</svg>`;

const options = (overrides: Partial<ConvertOptions> = {}): ConvertOptions => ({
  format: "png",
  quality: 85,
  background: "#ffffff",
  ...overrides,
});

let workspace: string;
let svgPath: string;
let transparentPngPath: string;

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "imgx-test-"));
  svgPath = join(workspace, "diagram.svg");
  await writeFile(svgPath, SVG);

  // Left half fully transparent, right half opaque red: a JPEG conversion must
  // paint the transparent half and keep the opaque half red.
  const width = 40;
  const height = 20;
  const pixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      pixels[offset] = 255;
      pixels[offset + 3] = x < width / 2 ? 0 : 255;
    }
  }
  transparentPngPath = join(workspace, "transparent.png");
  await writeFile(transparentPngPath, await Transformer.fromRgbaPixels(pixels, width, height).png());
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

function expectNear(actual: number[], expected: number[]) {
  expected.forEach((value, index) => {
    expect(Math.abs(actual[index] - value)).toBeLessThanOrEqual(2);
  });
}

async function metadataOf(path: string) {
  return new Transformer(Buffer.from(await Bun.file(path).arrayBuffer())).metadata();
}

async function pixelsOf(path: string) {
  return new Transformer(Buffer.from(await Bun.file(path).arrayBuffer())).rawPixels();
}

describe("svg rasterization", () => {
  test("renders at exactly the requested width, preserving aspect ratio", async () => {
    const output = join(workspace, "wide.png");
    const result = await convert(svgPath, output, options({ width: 1200 }));

    expect(result.width).toBe(1200);
    expect(result.height).toBe(600);
    const meta = await metadataOf(output);
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(1200);
  });

  test("renders at a scale factor", async () => {
    const output = join(workspace, "scaled.png");
    const result = await convert(svgPath, output, options({ scale: 2 }));
    expect(result.width).toBe(240);
    expect(result.height).toBe(120);
  });

  test("keeps the intrinsic size when no size is requested", async () => {
    const output = join(workspace, "intrinsic.png");
    const result = await convert(svgPath, output, options());
    expect(result.width).toBe(120);
    expect(result.height).toBe(60);
  });

  test("does not upscale a raster even when asked for a larger width", async () => {
    const output = join(workspace, "big.png");
    const result = await convert(transparentPngPath, output, options({ width: 4000 }));
    expect(result.width).toBe(40);
    expect(result.height).toBe(20);
  });

  test("shrinks a raster to the requested width", async () => {
    const source = join(workspace, "wide-source.png");
    await convert(svgPath, source, options({ width: 1000 }));

    const output = join(workspace, "shrunk.png");
    const result = await convert(source, output, options({ width: 250 }));
    expect(result.width).toBe(250);
    expect(result.height).toBe(125);
  });
});

describe("format conversion", () => {
  test("writes webp and reads it back", async () => {
    const webp = join(workspace, "hero.webp");
    await convert(svgPath, webp, options({ format: "webp" }));
    expect((await metadataOf(webp)).format).toBe("webp");

    const png = join(workspace, "hero-roundtrip.png");
    await convert(webp, png, options({ format: "png" }));
    const meta = await metadataOf(png);
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(120);
  });

  test("writes avif and reads it back", async () => {
    const avif = join(workspace, "hero.avif");
    await convert(svgPath, avif, options({ format: "avif" }));
    expect((await metadataOf(avif)).format).toBe("avif");

    const png = join(workspace, "avif-roundtrip.png");
    await convert(avif, png, options());
    expect((await metadataOf(png)).width).toBe(120);
  });

  test("writes tiff", async () => {
    const tiff = join(workspace, "scan.tiff");
    await convert(svgPath, tiff, options({ format: "tiff" }));
    expect((await metadataOf(tiff)).format).toBe("tiff");
  });

  test("flattens transparency onto the background color for jpeg", async () => {
    const output = join(workspace, "flat.jpg");
    await convert(transparentPngPath, output, options({ format: "jpeg", background: "#003366" }));

    const pixels = await pixelsOf(output);
    const leftCorner = 5 * 40 * 3;
    const rightCorner = (5 * 40 + 35) * 3;
    // JPEG is lossy, so channel values may drift a couple of steps.
    expectNear([pixels[leftCorner], pixels[leftCorner + 1], pixels[leftCorner + 2]], [0, 51, 102]);
    expectNear([pixels[rightCorner], pixels[rightCorner + 1], pixels[rightCorner + 2]], [255, 0, 0]);
  });

  test("keeps transparency when writing png", async () => {
    const output = join(workspace, "alpha-kept.png");
    await convert(transparentPngPath, output, options());
    const pixels = await pixelsOf(output);
    expect(pixels[3]).toBe(0);
  });
});

describe("helpers", () => {
  test("maps extensions to formats", () => {
    expect(formatFromExtension("a.webp")).toBe("webp");
    expect(formatFromExtension("a.JPG")).toBe("jpeg");
    expect(formatFromExtension("a.tif")).toBe("tiff");
    expect(formatFromExtension("a.unknown")).toBeUndefined();
  });

  test("parses background colors", () => {
    expect(parseBackground("#003366")).toEqual([0, 51, 102]);
    expect(parseBackground("#fff")).toEqual([255, 255, 255]);
    expect(parseBackground("rgb(10, 20, 30)")).toEqual([10, 20, 30]);
    expect(parseBackground("white")).toEqual([255, 255, 255]);
    expect(() => parseBackground("rebeccapurple")).toThrow();
    expect(() => parseBackground("#12345")).toThrow();
    expect(() => parseBackground("rgb(300, 0, 0)")).toThrow();
  });
});
