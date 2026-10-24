/** PDF inspection/slimming in a worker thread: same result as inline, no event-loop stall, and a broken worker never fails the job. */
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const scratch = path.resolve(import.meta.dirname, `../.pdf-worker-test-${process.pid}`);
const workerFile = path.join(scratch, 'pdfWorker.cjs');
const { optimizePdfForCheapOcr } = await import('./lib/pdfProcessing');
const pool = await import('./lib/pdfWorkerPool');

async function samplePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i += 1) {
    const page = doc.addPage();
    const text = i === 1 ? 'Para pihak: PT Alpha and PT Beta. Jangka waktu 12 bulan. '
      : i === pages ? 'In witness whereof the parties signed. Meterai. '
        : i === 9 ? 'Nilai kontrak Rp 1.000.000 payment terms 30 hari. '
          : `Narrative page ${i} without any particular keyword. `;
    for (let line = 0; line < 40; line += 1) page.drawText(`${text} line ${line}`, { x: 30, y: 800 - line * 18, size: 10, font });
  }
  return Buffer.from(await doc.save());
}
// pdf-lib stamps the slimmed file with the current time, so its bytes differ between runs; everything else must be identical.
const strip = (result: any) => ({ ...result, optimizedBase64: undefined, optimizedSizeBytes: undefined, inspectionReport: { ...result.inspectionReport, inspectionTimeMs: 0 } });
const pagesOf = async (result: { optimizedBase64: string }) => (await PDFDocument.load(Buffer.from(result.optimizedBase64, 'base64'))).getPageCount();

before(async () => {
  fs.mkdirSync(scratch, { recursive: true });
  await build({ entryPoints: [path.resolve(import.meta.dirname, 'lib/pdfWorker.ts')], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: workerFile, logLevel: 'silent' });
});
after(async () => { await pool.stopPdfWorkers(); fs.rmSync(scratch, { recursive: true, force: true }); });

test('without a worker file the work runs inline', async () => {
  delete process.env.PDF_WORKER_FILE;
  assert.equal(pool.pdfWorkerFile(), null);
  const pdf = await samplePdf(4);
  assert.deepEqual(strip(await pool.optimizePdfOffThread(pdf)), strip(await optimizePdfForCheapOcr(pdf)));
});

test('a worker thread returns exactly what the inline pipeline returns, for bytes and for base64 input', async () => {
  process.env.PDF_WORKER_FILE = workerFile;
  assert.equal(pool.pdfWorkerFile(), workerFile);
  const pdf = await samplePdf(24); // more than 15 pages: pages are scored and slimmed
  const inline = await optimizePdfForCheapOcr(pdf);
  assert.ok(inline.processedPageCount < inline.originalPageCount, 'the sample is slimmed');
  const viaWorker = await pool.optimizePdfOffThread(pdf);
  assert.deepEqual(strip(viaWorker), strip(inline));
  assert.equal(await pagesOf(viaWorker), inline.processedPageCount, 'the slimmed PDF the worker returns is readable and has the selected pages');
  assert.deepEqual(strip(await pool.optimizePdfOffThread('data:application/pdf;base64,' + pdf.toString('base64'))), strip(inline));
  // Several at once queue behind the bounded threads and all complete.
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => pool.optimizePdfOffThread(pdf)));
  assert.ok(results.every((r) => r.fileHash === inline.fileHash && r.processedPageCount === inline.processedPageCount));
  assert.deepEqual(strip(await pool.optimizePdfOffThread(Buffer.from('not a pdf'))).hasDigitalText, false, 'unreadable input is handled like inline');
});

test('the event loop keeps turning while a worker reads a large PDF', async () => {
  process.env.PDF_WORKER_FILE = workerFile;
  const pdf = await samplePdf(120);
  const longestStall = async (work: () => Promise<unknown>) => {
    let longest = 0;
    let last = performance.now();
    const probe = setInterval(() => { const now = performance.now(); longest = Math.max(longest, now - last); last = now; }, 5);
    await work();
    clearInterval(probe);
    return longest;
  };
  const inlineStall = await longestStall(() => optimizePdfForCheapOcr(pdf));
  const workerStall = await longestStall(() => pool.optimizePdfOffThread(pdf));
  if (inlineStall < 150) return; // fast machine: nothing measurable to compare
  assert.ok(workerStall < inlineStall / 2, `worker stall ${Math.round(workerStall)} ms vs inline ${Math.round(inlineStall)} ms`);
});

test('a worker that cannot start or crashes falls back to inline processing', async () => {
  const broken = path.join(scratch, 'broken.cjs');
  fs.writeFileSync(broken, 'process.exit(3);');
  process.env.PDF_WORKER_FILE = broken;
  const pdf = await samplePdf(3);
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    assert.deepEqual(strip(await pool.optimizePdfOffThread(pdf)), strip(await optimizePdfForCheapOcr(pdf)));
  } finally { console.warn = warn; }
  process.env.PDF_WORKER = 'off';
  assert.equal(pool.pdfWorkerFile(), null);
  delete process.env.PDF_WORKER;
});
