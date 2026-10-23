import { api } from '../api/client';

/**
 * Deletes records one at a time (the API removes a single record per call) and returns the ids that failed.
 * The acting user is the verified session; nothing about the actor is sent.
 */
export async function deleteRecords(basePath: string, ids: string[]): Promise<string[]> {
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await api.delete(`${basePath}/${encodeURIComponent(id)}`);
    } catch {
      failed.push(id);
    }
  }
  return failed;
}
