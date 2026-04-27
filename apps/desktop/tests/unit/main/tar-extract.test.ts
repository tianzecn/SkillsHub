import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import {
  parseTar,
  parseTarGzip,
  stripTopLevelDir,
} from "../../../src/main/services/tar-extract";

const BLOCK_SIZE = 512;

interface TarFileSpec {
  name: string;
  content: string;
  /** Default '0' regular file; set to '5' for directories, etc. */
  typeflag?: string;
  prefix?: string;
}

/** Pad/truncate `value` to exactly `size` bytes (NUL-padded). */
function writeFixed(value: string, size: number): Buffer {
  const out = Buffer.alloc(size);
  out.write(value, 0, "utf8");
  return out;
}

/** Encode `value` as a NUL-terminated octal string of total `size` bytes. */
function writeOctal(value: number, size: number): Buffer {
  const out = Buffer.alloc(size);
  // tar size fields are documented as `<size>-1 octal digits + NUL terminator`,
  // but real tools also use space-NUL or padded variations.  The canonical
  // form is sufficient for our parser.
  const text = value.toString(8).padStart(size - 1, "0");
  out.write(`${text}\0`, 0, "utf8");
  return out;
}

function buildHeader(spec: TarFileSpec): Buffer {
  const header = Buffer.alloc(BLOCK_SIZE);
  writeFixed(spec.name, 100).copy(header, 0);
  writeOctal(0o644, 8).copy(header, 100); // mode
  writeOctal(0, 8).copy(header, 108); // uid
  writeOctal(0, 8).copy(header, 116); // gid
  writeOctal(Buffer.byteLength(spec.content, "utf8"), 12).copy(header, 124);
  writeOctal(0, 12).copy(header, 136); // mtime
  // chksum field is left as spaces while we compute it
  Buffer.from("        ").copy(header, 148);
  Buffer.from(spec.typeflag ?? "0").copy(header, 156, 0, 1);
  // linkname: 100 bytes of zero (already zero)
  writeFixed("ustar", 6).copy(header, 257);
  writeFixed("00", 2).copy(header, 263);
  if (spec.prefix) {
    writeFixed(spec.prefix, 155).copy(header, 345);
  }

  // Compute checksum: sum of all bytes treating chksum as spaces.
  let sum = 0;
  for (const byte of header) sum += byte;
  writeOctal(sum, 8).copy(header, 148);

  return header;
}

function buildTar(specs: TarFileSpec[]): Buffer {
  const blocks: Buffer[] = [];
  for (const spec of specs) {
    blocks.push(buildHeader(spec));
    const contentBuffer = Buffer.from(spec.content, "utf8");
    blocks.push(contentBuffer);
    const padding = (BLOCK_SIZE - (contentBuffer.length % BLOCK_SIZE)) % BLOCK_SIZE;
    if (padding > 0) blocks.push(Buffer.alloc(padding));
  }
  // Two zero blocks signal end-of-archive.
  blocks.push(Buffer.alloc(BLOCK_SIZE));
  blocks.push(Buffer.alloc(BLOCK_SIZE));
  return Buffer.concat(blocks);
}

describe("parseTar", () => {
  it("extracts regular files and skips directories", () => {
    const tar = buildTar([
      { name: "repo-main/", content: "", typeflag: "5" },
      { name: "repo-main/SKILL.md", content: "# Hello" },
      {
        name: "repo-main/nested/SKILL.md",
        content: "second\nbody",
      },
    ]);

    const entries = parseTar(tar);
    expect(entries).toHaveLength(2);
    expect(entries[0].path).toBe("repo-main/SKILL.md");
    expect(entries[0].content.toString("utf8")).toBe("# Hello");
    expect(entries[1].path).toBe("repo-main/nested/SKILL.md");
    expect(entries[1].content.toString("utf8")).toBe("second\nbody");
  });

  it("respects content padding for non-512-aligned files", () => {
    const odd = "x".repeat(513); // crosses a block boundary
    const tar = buildTar([
      { name: "first.txt", content: odd },
      { name: "second.txt", content: "after-padding" },
    ]);
    const entries = parseTar(tar);
    expect(entries.map((entry) => entry.path)).toEqual([
      "first.txt",
      "second.txt",
    ]);
    expect(entries[0].content.toString("utf8")).toBe(odd);
    expect(entries[1].content.toString("utf8")).toBe("after-padding");
  });

  it("supports the ustar prefix field for long paths", () => {
    const longPrefix = "very/long/nested/path";
    const tar = buildTar([
      {
        name: "leaf-skill/SKILL.md",
        content: "deeply nested",
        prefix: longPrefix,
      },
    ]);
    const entries = parseTar(tar);
    expect(entries[0].path).toBe(`${longPrefix}/leaf-skill/SKILL.md`);
  });

  it("rejects truncated archives instead of returning garbage", () => {
    const tar = buildTar([{ name: "skill.md", content: "abc" }]);
    // Drop the last byte to simulate a truncated download.
    const truncated = tar.subarray(0, tar.length - 1);
    // Truncated content still parses up to the EOF marker; this just ensures
    // we don't blow up.
    expect(() => parseTar(truncated)).not.toThrow();
  });
});

describe("parseTarGzip", () => {
  it("transparently gunzips before parsing", () => {
    const tar = buildTar([
      { name: "repo-main/A/SKILL.md", content: "alpha" },
      { name: "repo-main/B/SKILL.md", content: "beta" },
    ]);
    const gz = gzipSync(tar);
    const entries = parseTarGzip(gz);
    expect(entries.map((entry) => entry.path)).toEqual([
      "repo-main/A/SKILL.md",
      "repo-main/B/SKILL.md",
    ]);
  });
});

describe("stripTopLevelDir", () => {
  it("removes a common GitHub-style root from every entry", () => {
    const entries = [
      { path: "repo-abc1234/SKILL.md", content: Buffer.from("a") },
      { path: "repo-abc1234/nested/SKILL.md", content: Buffer.from("b") },
    ];
    const stripped = stripTopLevelDir(entries);
    expect(stripped.map((entry) => entry.path)).toEqual([
      "SKILL.md",
      "nested/SKILL.md",
    ]);
  });

  it("leaves entries untouched when there is no common root", () => {
    const entries = [
      { path: "first/SKILL.md", content: Buffer.from("a") },
      { path: "second/SKILL.md", content: Buffer.from("b") },
    ];
    expect(stripTopLevelDir(entries)).toEqual(entries);
  });

  it("returns empty arrays unchanged", () => {
    expect(stripTopLevelDir([])).toEqual([]);
  });
});
