import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

interface FormatRow {
  format: string;
  read: string;
  write: string;
}

/** The formats matrix as declared in the roff man page, which is the source of truth. */
async function manPageMatrix(): Promise<FormatRow[]> {
  const source = await readFile(join(ROOT, "man", "imgx.1"), "utf8");
  const table = source.split(".TS\n")[1].split(".TE")[0].trim().split("\n");

  // The first three lines are the table spec, the column spec and the header row.
  return table
    .slice(3)
    .map((line) => line.split(":").map((cell) => cell.trim()))
    .filter((cells) => cells.length === 4)
    .map(([format, , read, write]) => ({ format, read, write }));
}

/** The same matrix as rendered into one of the website pages. */
async function siteMatrix(file: string): Promise<FormatRow[]> {
  const page = await readFile(join(ROOT, "site", file), "utf8");
  const section = page.split("<h2>Formats</h2>")[1].split("</section>")[0];

  const rows: FormatRow[] = [];
  for (const row of section.matchAll(/<tr>(.*?)<\/tr>/gs)) {
    const cells = [...row[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map((cell) =>
      cell[1].replace(/<[^>]+>/g, "").trim(),
    );
    if (cells.length !== 5) continue;
    if (cells[0].toLowerCase() === "format") continue;
    rows.push({ format: cells[0], read: cells[2], write: cells[3] });
  }
  return rows;
}

describe("formats matrix", () => {
  test("the website and the manual page agree", async () => {
    const man = await manPageMatrix();
    const index = await siteMatrix("index.html");
    const help = await siteMatrix("help.html");

    expect(man.length).toBeGreaterThan(0);
    expect(index).toEqual(man);
    expect(help).toEqual(man);
  });

  test("every format that can be written is listed in the CLI help", async () => {
    const help = await readFile(join(ROOT, "src", "cli.ts"), "utf8");
    const man = await manPageMatrix();

    for (const row of man.filter((format) => format.write === "yes")) {
      expect(help).toContain(row.format);
    }
  });

  test("the manual page lists every format the CLI accepts as input", async () => {
    const inputs = await readFile(join(ROOT, "src", "inputs.ts"), "utf8");
    const man = await manPageMatrix();
    const listed = man.filter((format) => format.read !== "no").map((format) => format.format);

    for (const extension of discoverableExtensions(inputs)) {
      const canonical = ALIASES[extension] ?? extension;
      expect(listed).toContain(canonical);
    }
  });

  test("every alias the CLI accepts is a known one", async () => {
    // A new extension added to inputs.ts must be added to the matrix or to
    // ALIASES, otherwise the matrix silently stops describing the CLI.
    const inputs = await readFile(join(ROOT, "src", "inputs.ts"), "utf8");
    for (const extension of discoverableExtensions(inputs)) {
      const canonical = ALIASES[extension] ?? extension;
      expect(canonical === extension || ALIASES[extension] !== undefined).toBe(true);
    }
  });
});

/** Pull the extension list out of the DISCOVERABLE_EXTENSIONS set in src/inputs.ts. */
function discoverableExtensions(source: string): string[] {
  const set = source.split("const DISCOVERABLE_EXTENSIONS = new Set([")[1].split("])")[0];
  return [...set.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

/**
 * Extensions that are aliases of a format the matrix lists under another name.
 * The matrix names canonical formats, not every extension the CLI accepts.
 */
const ALIASES: Record<string, string> = {
  jpg: "jpeg",
  jpe: "jpeg",
  tif: "tiff",
  ppm: "pnm",
  pgm: "pnm",
  pbm: "pnm",
  dng: "camera raw",
  cr2: "camera raw",
  cr3: "camera raw",
  nef: "camera raw",
  nrw: "camera raw",
  arw: "camera raw",
  raf: "camera raw",
  orf: "camera raw",
  rw2: "camera raw",
  pef: "camera raw",
  srw: "camera raw",
};
