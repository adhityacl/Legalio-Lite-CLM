/**
 * Worker-thread entry of the PDF pipeline (bundled to dist/pdfWorker.cjs by `npm run build:worker`). Receives `{ id, input }` (a data-URL or
 * base64 string, or the PDF bytes) and answers `{ id, result }` or `{ id, error }`.
 */
import { parentPort } from 'node:worker_threads';
import { optimizePdfForCheapOcr } from './pdfProcessing';

parentPort?.on('message', (message: { id: number; input: string | Uint8Array }) => {
  const { id, input } = message;
  const source = typeof input === 'string' ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  optimizePdfForCheapOcr(source).then(
    (result) => parentPort?.postMessage({ id, result }),
    (error: unknown) => parentPort?.postMessage({ id, error: error instanceof Error ? error.message : String(error) }),
  );
});
