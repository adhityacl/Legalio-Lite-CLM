export interface TerminationFile {
  fileName: string;
  fileData: string;
  mimeType: string;
  extension: string;
}

/** Validate uploaded evidence before any existing attachment is replaced. */
export function parseTerminationFile(value: unknown): TerminationFile | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== 'object') throw new Error('termination.file_invalid');
  const input = value as Record<string, unknown>;
  if (typeof input.fileName !== 'string' || typeof input.fileData !== 'string') throw new Error('termination.file_invalid');
  const extension = input.fileName.split('.').at(-1)?.toLowerCase();
  const match = /^data:[^;,]*;base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.fileData);
  if (!extension || !['pdf', 'doc', 'docx'].includes(extension) || !match || match[1].length > 14 * 1024 * 1024) throw new Error('termination.file_invalid');
  const bytes = Buffer.from(match[1], 'base64');
  if (bytes.length === 0 || bytes.length > 10 * 1024 * 1024) throw new Error('termination.file_invalid');
  const valid = extension === 'pdf' ? bytes.subarray(0, 5).toString() === '%PDF-'
    : extension === 'docx' ? bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
      : bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
  if (!valid) throw new Error('termination.file_invalid');
  return { fileName: input.fileName.replace(/[/\\\x00-\x1f]/g, '_').slice(0, 255), fileData: input.fileData, extension,
    mimeType: extension === 'pdf' ? 'application/pdf' : extension === 'doc' ? 'application/msword' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
}
