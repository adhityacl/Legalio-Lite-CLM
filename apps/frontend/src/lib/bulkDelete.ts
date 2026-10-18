/** Deletes records one at a time (the API removes a single record per call) and returns the ids that failed. */
export async function deleteRecords(
  basePath: string,
  ids: string[],
  actor: { userEmail?: string; userName?: string; userRole?: string },
): Promise<string[]> {
  const query = new URLSearchParams({
    userEmail: actor.userEmail || '',
    userName: actor.userName || '',
    userRole: actor.userRole || '',
  }).toString();
  const failed: string[] = [];
  for (const id of ids) {
    try {
      const response = await fetch(`${basePath}/${encodeURIComponent(id)}?${query}`, { method: 'DELETE' });
      if (!response.ok) failed.push(id);
    } catch {
      failed.push(id);
    }
  }
  return failed;
}
