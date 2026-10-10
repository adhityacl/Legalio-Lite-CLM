/**
 * Unsaved-change guard (tenant-boundaries PRD §6.8). Forms register a dirty
 * check; tab/organization switches ask before leaving and never auto-save.
 */
type DirtyCheck = () => boolean;
const checks = new Set<DirtyCheck>();

export function registerDirtyCheck(check: DirtyCheck): () => void {
  checks.add(check);
  return () => checks.delete(check);
}

export const hasUnsavedChanges = (): boolean => Array.from(checks).some((check) => check());

/** Resolves true when there is nothing to lose or the user chose "Discard changes". */
export async function confirmLeave(ask: () => Promise<boolean>): Promise<boolean> {
  return hasUnsavedChanges() ? ask() : true;
}
