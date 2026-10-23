import { downloadFile } from '../api/assistant';
import type { ContractLifecycleFields } from '@legalio/shared/contractLifecycle';

/** Local evidence uses the same authenticated file route as other uploaded documents. */
export async function openTerminationDocument(document: NonNullable<ContractLifecycleFields['termination_document']>) {
  if (!document.url.startsWith('/uploads/')) {
    window.open(document.url, '_blank', 'noopener,noreferrer');
    return;
  }
  let blob: Blob;
  try { blob = await downloadFile(document.url); } catch { throw new Error('termination.file_open_error'); }
  const url = URL.createObjectURL(blob);
  const link = window.document.createElement('a');
  link.href = url;
  link.download = document.fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
