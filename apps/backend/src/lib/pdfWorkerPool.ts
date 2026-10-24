/**
 * Runs the CPU-heavy PDF work (pdf-parse text extraction, pdf-lib slimming) in worker threads so a large scan does not stall the event
 * loop that serves every other request.
 *
 * - The worker is `pdfWorker.cjs` next to the server bundle (or the file named by PDF_WORKER_FILE). Without one (development with tsx, tests)
 *   the work runs inline, exactly as before. PDF_WORKER=off forces inline.
 * - PDF_WORKER_THREADS (default 2) bounds the threads; further jobs wait in a queue.
 * - Any failure of the worker (crash, timeout, unreadable result) falls back to doing that job inline, so a worker problem never fails an upload.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { optimizePdfForCheapOcr, type OptimizedPdfResult } from './pdfProcessing';

const JOB_TIMEOUT_MS = 120_000;

interface Job { id: number; input: string | Uint8Array; resolve: (result: OptimizedPdfResult) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }
interface Slot { worker: Worker; job?: Job }

let slots: Slot[] = [];
let queue: Job[] = [];
let nextId = 1;
let stopped = false;

export function pdfWorkerFile(): string | null {
  if ((process.env.PDF_WORKER || '').toLowerCase() === 'off') return null;
  const explicit = (process.env.PDF_WORKER_FILE || '').trim();
  const candidate = explicit || (typeof __dirname === 'string' ? path.join(__dirname, 'pdfWorker.cjs') : '');
  return candidate && fs.existsSync(candidate) ? candidate : null;
}

const maxThreads = () => Math.max(1, Math.min(8, Math.trunc(Number(process.env.PDF_WORKER_THREADS)) || 2));

function failJob(slot: Slot, error: Error) {
  const job = slot.job;
  slot.job = undefined;
  if (job) { clearTimeout(job.timer); job.reject(error); }
}

function spawn(file: string): Slot {
  const worker = new Worker(file);
  worker.unref(); // an idle worker never keeps the process alive
  const slot: Slot = { worker };
  worker.on('message', (message: { id: number; result?: OptimizedPdfResult; error?: string }) => {
    const job = slot.job;
    if (!job || job.id !== message.id) return;
    slot.job = undefined;
    clearTimeout(job.timer);
    if (message.result) job.resolve(message.result); else job.reject(new Error(message.error || 'PDF worker failed'));
    pump();
  });
  worker.on('error', (error) => { failJob(slot, error); remove(slot); });
  worker.on('exit', () => { failJob(slot, new Error('PDF worker exited')); remove(slot); });
  return slot;
}

function remove(slot: Slot) {
  slots = slots.filter((s) => s !== slot);
  pump();
}

function pump() {
  const file = pdfWorkerFile();
  while (queue.length && file && !stopped) {
    let slot = slots.find((s) => !s.job);
    if (!slot && slots.length < maxThreads()) { slot = spawn(file); slots.push(slot); }
    if (!slot) return;
    const job = queue.shift()!;
    slot.job = job;
    job.timer = setTimeout(() => { const busy = slot!; failJob(busy, new Error('PDF worker timed out')); void busy.worker.terminate(); remove(busy); }, JOB_TIMEOUT_MS);
    slot.worker.postMessage({ id: job.id, input: job.input });
  }
}

/** Slims and reads a PDF (data-URL, base64 string or bytes); in a worker thread when one is available, inline otherwise or on any worker failure. */
export async function optimizePdfOffThread(input: string | Buffer): Promise<OptimizedPdfResult> {
  if (!pdfWorkerFile() || stopped) return optimizePdfForCheapOcr(input);
  const bytes: string | Uint8Array = typeof input === 'string' ? input : new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength) as ArrayBuffer);
  try {
    return await new Promise<OptimizedPdfResult>((resolve, reject) => {
      queue.push({ id: nextId++, input: bytes, resolve, reject });
      pump();
    });
  } catch (error) {
    console.warn('PDF worker failed, processing inline:', error instanceof Error ? error.message : error);
    return optimizePdfForCheapOcr(input);
  }
}

/** Ends the worker threads (graceful shutdown, tests). Later calls run inline until `startPdfWorkers`. */
export async function stopPdfWorkers(): Promise<void> {
  stopped = true;
  const pending = queue;
  queue = [];
  for (const job of pending) job.reject(new Error('PDF workers stopped'));
  const closing = slots;
  slots = [];
  await Promise.all(closing.map(async (slot) => { failJob(slot, new Error('PDF workers stopped')); await slot.worker.terminate(); }));
}

export function startPdfWorkers() { stopped = false; }
