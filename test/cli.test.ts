import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "cli.ts");

const SVG = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#0088ff"/><text x="4" y="24" font-size="12" fill="#fff">${label}</text></svg>`;

let workspace: string;
let projectDirectory: string;

interface Run {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function run(args: string[], cwd: string): Promise<Run> {
  const process = Bun.spawn(["bun", CLI, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), "imgx-cli-"));
  projectDirectory = join(workspace, "project");
  await mkdir(join(projectDirectory, "diagrams", "nested"), { recursive: true });
  await writeFile(join(projectDirectory, "diagrams", "one.svg"), SVG("one"));
  await writeFile(join(projectDirectory, "diagrams", "nested", "two.svg"), SVG("two"));
  await writeFile(join(projectDirectory, "single.svg"), SVG("single"));
});

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true });
});

describe("imgx cli", () => {
  test("creates a missing destination directory", async () => {
    const result = await run(["single.svg", "-o", "build/icons"], projectDirectory);

    expect(result.exitCode).toBe(0);
    expect(await exists(join(projectDirectory, "build", "icons", "single.png"))).toBe(true);
    expect(result.stdout).toContain("1 converted");
  });

  test("mirrors the input folder structure into the destination", async () => {
    const result = await run(["diagrams", "-f", "webp", "-o", "build/webp"], projectDirectory);

    expect(result.exitCode).toBe(0);
    expect(await exists(join(projectDirectory, "build", "webp", "one.webp"))).toBe(true);
    expect(await exists(join(projectDirectory, "build", "webp", "nested", "two.webp"))).toBe(true);
    expect(result.stdout).toContain("2 converted");
  });

  test("treats a path with an image extension as the output file", async () => {
    const result = await run(["single.svg", "-o", "exact-name.png"], projectDirectory);

    expect(result.exitCode).toBe(0);
    expect(await exists(join(projectDirectory, "exact-name.png"))).toBe(true);
  });

  test("skips existing files unless --overwrite is passed", async () => {
    const first = await run(["single.svg", "-o", "keep.png"], projectDirectory);
    const second = await run(["single.svg", "-o", "keep.png"], projectDirectory);
    const third = await run(["single.svg", "-o", "keep.png", "--overwrite"], projectDirectory);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toContain("1 skipped");
    expect(third.stdout).toContain("1 converted");
  });

  test("expands globs and writes nothing with --dry-run", async () => {
    const result = await run(["diagrams/*.svg", "-o", "dry", "--dry-run"], projectDirectory);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("diagrams/one.svg");
    expect(await exists(join(projectDirectory, "dry"))).toBe(false);
  });

  test("does not convert files inside the destination directory", async () => {
    await run(["single.svg", "-o", "work/png"], projectDirectory);
    const second = await run([".", "-f", "webp", "-o", "work/png"], projectDirectory);

    expect(second.exitCode).toBe(0);
    expect(second.stdout).not.toContain("work/png/single.png");
  });

  test("still converts into the current directory when asked", async () => {
    const result = await run([".", "-f", "webp", "-o", "."], projectDirectory);

    expect(result.exitCode).toBe(0);
    expect(await exists(join(projectDirectory, "single.webp"))).toBe(true);
  });

  test("documents every --flag from --help in the manual page", async () => {
    const help = await run(["--help"], projectDirectory);
    const manPage = (await Bun.file(join(import.meta.dir, "..", "man", "imgx.1")).text()).replaceAll("\\-", "-");
    const flags = new Set([...help.stdout.matchAll(/--[a-z][a-z-]+/g)].map((match) => match[0]));

    expect(flags.size).toBeGreaterThan(8);
    for (const flag of flags) expect(manPage).toContain(flag);
  });

  test("rejects a destination file when several inputs are given", async () => {
    const result = await run(["diagrams", "-o", "collision.png"], projectDirectory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("pass a directory");
  });

  test("rejects an unknown format with the supported list", async () => {
    const result = await run(["single.svg", "-f", "gif"], projectDirectory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("png, jpeg, webp, avif, tiff");
  });

  test("rejects a background color it cannot parse", async () => {
    const result = await run(["single.svg", "-f", "jpeg", "--background", "rebeccapurple"], projectDirectory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("cannot parse --background");
  });

  test("reports a missing input without writing anything", async () => {
    const result = await run(["missing.svg"], projectDirectory);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no such file or directory");
  });

  test("prints help and the version", async () => {
    const help = await run(["--help"], projectDirectory);
    const version = await run(["--version"], projectDirectory);

    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("imgx - convert images from the terminal");
    expect(version.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test.skipIf(process.platform !== "darwin")("decodes heic through the sips fallback", async () => {
    const heic = join(projectDirectory, "photo.heic");
    const source = join(projectDirectory, "single.png");
    await run(["single.svg", "-o", source], projectDirectory);
    const sips = Bun.spawnSync(["sips", "-s", "format", "heic", source, "--out", heic]);
    expect(sips.exitCode).toBe(0);

    const outputDirectory = join(projectDirectory, "from-heic");
    const result = await run(["photo.heic", "-f", "png", "-o", outputDirectory], projectDirectory);

    expect(result.exitCode).toBe(0);
    expect(await exists(join(outputDirectory, "photo.png"))).toBe(true);
  });
});
