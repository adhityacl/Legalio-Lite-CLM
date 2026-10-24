/**
 * Minimal streaming ZIP writer (no dependency). Each entry is deflated as it is written and described by a data descriptor, so
 * neither the archive nor a whole entry has to fit in memory; the central directory follows the last entry. Sizes and offsets
 * are limited to 4 GiB (no ZIP64): `ZipLimitError` is thrown instead of producing a corrupt archive.
 */
import zlib from 'node:zlib';

export class ZipLimitError extends Error {}

const LIMIT = 0xffff_ffff;
const DOS_DATE = (date: Date) => ({
  time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1),
  date: (Math.max(1980, date.getUTCFullYear()) - 1980) << 9 | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
});

interface CentralEntry { name: Buffer; crc: number; compressed: number; size: number; offset: number; time: number; date: number; method: number }

export function createZipWriter(write: (chunk: Buffer) => Promise<void> | void, now = new Date()) {
  let offset = 0;
  let finished = false;
  const entries: CentralEntry[] = [];
  const names = new Set<string>();
  const { time, date } = DOS_DATE(now);

  // Chunks reach `write` strictly in the order they were produced, even though deflate emits them from events.
  let chain: Promise<void> = Promise.resolve();
  const emit = (chunk: Buffer): Promise<void> => {
    offset += chunk.length;
    if (offset > LIMIT) return Promise.reject(new ZipLimitError('The archive exceeds the 4 GiB limit of this format.'));
    return chain = chain.then(() => write(chunk));
  };

  /** Adds one entry from a buffer or any async iterable of buffers/strings. `store` skips deflate (already compressed files). */
  async function addEntry(name: string, content: Buffer | string | AsyncIterable<Buffer | string>, options: { store?: boolean } = {}) {
    if (finished) throw new Error('The archive is already finished.');
    const cleaned = name.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!cleaned || cleaned.split('/').some((part) => part === '..' || part === '')) throw new Error(`Invalid entry name: ${name}`);
    if (names.has(cleaned)) throw new Error(`Duplicate entry name: ${cleaned}`);
    names.add(cleaned);
    const nameBuffer = Buffer.from(cleaned, 'utf8');
    const method = options.store ? 0 : 8;
    const start = offset;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0808, 6); // data descriptor follows, UTF-8 names
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(date, 12);
    header.writeUInt16LE(nameBuffer.length, 26);
    await emit(Buffer.concat([header, nameBuffer]));

    let crc = 0;
    let size = 0;
    let compressed = 0;
    const deflate = method === 8 ? zlib.createDeflateRaw({ level: 6 }) : null;
    const pending: Promise<void>[] = [];
    let failure: unknown;
    if (deflate) {
      deflate.on('data', (chunk: Buffer) => { compressed += chunk.length; pending.push(emit(chunk).catch((err) => { failure = err; })); });
    }
    const source: AsyncIterable<Buffer | string> = typeof content === 'string' || Buffer.isBuffer(content)
      ? (async function* () { yield content; })() : content;
    for await (const part of source) {
      const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part, 'utf8');
      if (!chunk.length) continue;
      crc = zlib.crc32(chunk, crc);
      size += chunk.length;
      if (size > LIMIT) throw new ZipLimitError('An entry exceeds the 4 GiB limit of this format.');
      if (deflate) {
        // Backpressure: wait for the deflater to drain before feeding it more.
        if (!deflate.write(chunk)) await new Promise<void>((resolve) => deflate.once('drain', resolve));
        await Promise.all(pending.splice(0));
      } else {
        compressed += chunk.length;
        await emit(chunk);
      }
      if (failure) throw failure;
    }
    if (deflate) {
      await new Promise<void>((resolve, reject) => { deflate.once('end', resolve); deflate.once('error', reject); deflate.end(); });
      await Promise.all(pending.splice(0));
      if (failure) throw failure;
    }
    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(crc >>> 0, 4);
    descriptor.writeUInt32LE(compressed, 8);
    descriptor.writeUInt32LE(size, 12);
    await emit(descriptor);
    entries.push({ name: nameBuffer, crc: crc >>> 0, compressed, size, offset: start, time, date, method });
  }

  async function finish() {
    if (finished) return;
    finished = true;
    const directoryStart = offset;
    for (const entry of entries) {
      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt16LE(20, 4);
      record.writeUInt16LE(20, 6);
      record.writeUInt16LE(0x0808, 8);
      record.writeUInt16LE(entry.method, 10);
      record.writeUInt16LE(entry.time, 12);
      record.writeUInt16LE(entry.date, 14);
      record.writeUInt32LE(entry.crc, 16);
      record.writeUInt32LE(entry.compressed, 20);
      record.writeUInt32LE(entry.size, 24);
      record.writeUInt16LE(entry.name.length, 28);
      record.writeUInt32LE(entry.offset, 42);
      await emit(Buffer.concat([record, entry.name]));
    }
    const directorySize = offset - directoryStart;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Math.min(entries.length, 0xffff), 8);
    end.writeUInt16LE(Math.min(entries.length, 0xffff), 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(directoryStart, 16);
    await emit(end);
  }

  return { addEntry, finish, get bytes() { return offset; }, get entryCount() { return entries.length; } };
}
