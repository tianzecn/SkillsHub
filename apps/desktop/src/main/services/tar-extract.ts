/**
 * Minimal USTAR/POSIX tar reader.
 *
 * Why hand-rolled:  GitHub tarballs are tiny (a few MB at most) and we only
 * need read access to a handful of regular files (SKILL.md, README.md).
 * Pulling in `tar-stream` or `node-tar` for that would add ~150kB to the
 * Electron bundle and a streaming API we don't need.  The USTAR header
 * format is fully documented and trivial to parse.
 *
 * Format reference:
 *   https://www.gnu.org/software/tar/manual/html_node/Standard.html
 *   - Each entry: 512-byte header + N bytes of content + padding to 512
 *   - `name` (100 bytes), `size` (12 bytes octal), `typeflag` (1 byte)
 *   - `prefix` (155 bytes) — concatenated with name/ for paths > 100 chars
 *   - End of archive: two consecutive 512-byte blocks of zeros
 *   - typeflag '0' or '\0' = regular file (only kind we extract)
 */

import { gunzipSync } from "node:zlib";

const BLOCK_SIZE = 512;

/** A single regular file extracted from a tar archive. */
export interface TarFileEntry {
  /** Path inside the archive, with the GitHub top-level directory prefix removed when applicable. */
  path: string;
  content: Buffer;
}

function readNullTerminatedString(buffer: Buffer, offset: number, length: number): string {
  const slice = buffer.subarray(offset, offset + length);
  const nullIndex = slice.indexOf(0);
  const usable = nullIndex === -1 ? slice : slice.subarray(0, nullIndex);
  return usable.toString("utf8");
}

function parseOctalSize(buffer: Buffer, offset: number, length: number): number {
  // GNU tar can use base-256 encoding for sizes >= 8GiB by setting the high
  // bit of the first byte; we never expect that for SKILL.md tarballs but
  // guard against silently misreading it.
  const first = buffer[offset];
  if ((first & 0x80) !== 0) {
    throw new Error("Tar entry uses base-256 size encoding, which is not supported");
  }
  const text = readNullTerminatedString(buffer, offset, length).trim();
  if (text.length === 0) return 0;
  const parsed = Number.parseInt(text, 8);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid tar size field: "${text}"`);
  }
  return parsed;
}

function isAllZeroBlock(buffer: Buffer, offset: number): boolean {
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    if (buffer[offset + i] !== 0) return false;
  }
  return true;
}

function buildEntryPath(buffer: Buffer, offset: number): string {
  const name = readNullTerminatedString(buffer, offset, 100);
  // USTAR prefix at offset 345 (157 from header start - 12 already consumed).
  // But the header layout uses absolute offsets within a 512-byte block:
  //   name=0..100, mode=100..108, uid=108..116, gid=116..124, size=124..136,
  //   mtime=136..148, chksum=148..156, typeflag=156..157, linkname=157..257,
  //   magic=257..263, version=263..265, uname=265..297, gname=297..329,
  //   devmajor=329..337, devminor=337..345, prefix=345..500.
  const magic = readNullTerminatedString(buffer, offset + 257, 6);
  if (magic === "ustar") {
    const prefix = readNullTerminatedString(buffer, offset + 345, 155);
    if (prefix.length > 0) {
      return `${prefix}/${name}`;
    }
  }
  return name;
}

/**
 * Parse a tar (uncompressed) buffer and return all *regular files*.
 * Directory entries, symlinks, hardlinks, longlinks, and PAX extended
 * headers are skipped silently.
 */
export function parseTar(tarBuffer: Buffer): TarFileEntry[] {
  const entries: TarFileEntry[] = [];
  let offset = 0;

  while (offset + BLOCK_SIZE <= tarBuffer.length) {
    if (isAllZeroBlock(tarBuffer, offset)) {
      // End-of-archive marker (two zero blocks, but a single one already
      // signals the trailer in the wild — bail out).
      break;
    }

    const path = buildEntryPath(tarBuffer, offset);
    const size = parseOctalSize(tarBuffer, offset + 124, 12);
    const typeflag = String.fromCharCode(tarBuffer[offset + 156]);

    const contentStart = offset + BLOCK_SIZE;
    const contentEnd = contentStart + size;
    if (contentEnd > tarBuffer.length) {
      throw new Error(
        `Tar entry "${path}" claims size ${size} but archive is only ${tarBuffer.length} bytes`,
      );
    }

    // typeflag '0' = regular file (POSIX), '\0' = legacy regular file.
    // Anything else (directories='5', symlinks='2', PAX='x', longlink='L'…)
    // is skipped — we still respect their content padding so subsequent
    // entries align correctly.
    if (typeflag === "0" || typeflag === "\0") {
      entries.push({
        path,
        content: tarBuffer.subarray(contentStart, contentEnd),
      });
    }

    // Each entry's content is padded to a 512-byte boundary.
    const paddedSize = Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;
    offset = contentStart + paddedSize;
  }

  return entries;
}

/**
 * Decompress a gzip buffer and return regular file entries.
 * Convenience wrapper for GitHub tarballs which are always served as .tar.gz.
 */
export function parseTarGzip(tarGzBuffer: Buffer): TarFileEntry[] {
  const tarBuffer = gunzipSync(tarGzBuffer);
  return parseTar(tarBuffer);
}

/**
 * Strip the GitHub-style top-level directory (e.g. `repo-branch-sha/`) from
 * every entry path.  Entries that do *not* sit under a single common parent
 * are left untouched.
 */
export function stripTopLevelDir(entries: TarFileEntry[]): TarFileEntry[] {
  if (entries.length === 0) return entries;

  const firstSlash = entries[0].path.indexOf("/");
  if (firstSlash === -1) return entries;
  const root = entries[0].path.slice(0, firstSlash + 1);

  for (const entry of entries) {
    if (!entry.path.startsWith(root)) {
      return entries;
    }
  }

  return entries.map((entry) => ({
    path: entry.path.slice(root.length),
    content: entry.content,
  }));
}
