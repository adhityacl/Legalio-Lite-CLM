import { useCallback, useMemo, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { useLanguage } from '../../context/LanguageContext';
import { usePermissions } from '../../lib/permissions';
import { ApiError, isApiError } from '../../api/client';
import { workspaceApi, type WorkspaceSnapshot } from '../../api/workspace';
import type { GoogleSheetsConfig } from '@legalio/types';

type WorkspaceData = WorkspaceSnapshot;

/** Absence is empty/unavailable — never another deployment's resources. */
export const EMPTY_WORKSPACE: WorkspaceData = {
  organizationId: '',
  contracts: [], ios: [], partners: [], notifications: [], evaluations: [], spendings: [],
  services: { aiAvailable: false, googleUploadsAvailable: false },
  timestamp: 0,
};

/** Cache key of the organization's workspace snapshot; mutations and views invalidate this exact key. */
export const workspaceQueryKey = (identityId: string | undefined, organizationId: string | null | undefined) => ['init-data', identityId, organizationId] as const;

/** Normalizes an `init-data` response: every collection is an array, the timestamp is set. */
export function normalizeWorkspace(data: Partial<WorkspaceData>): WorkspaceData {
  const normalized: WorkspaceData = { ...EMPTY_WORKSPACE, ...data };
  for (const key of ['contracts', 'ios', 'partners', 'notifications', 'evaluations', 'spendings'] as const) {
    if (!Array.isArray(normalized[key])) (normalized as any)[key] = [];
  }
  normalized.timestamp = data.timestamp || Date.now();
  return normalized;
}

/** Query cache owns workspace records; UI state stays in the feature views. */
export function useWorkspaceData() {
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  const { t } = useLanguage();
  const { hasPermission, organizationId: capabilityOrganization } = usePermissions();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => workspaceQueryKey(identity?.id, activeTenantId), [identity?.id, activeTenantId]);
  const query = useQuery<WorkspaceData>({
    queryKey,
    queryFn: async ({ signal }) => {
      // The organization is captured when the request is built; a later switch never changes it.
      const organizationId = activeTenantId;
      let data: WorkspaceData;
      try {
        data = await workspaceApi.initData(organizationId, signal);
      } catch (error) {
        if (isApiError(error) && error.status === 404) window.dispatchEvent(new CustomEvent('organization-access-lost', { detail: organizationId }));
        if (isApiError(error)) throw new ApiError({ ...error.toJSON(), message: t('app.failed_to_fetch_initial_data', 'Failed to fetch initial data'), body: error.body });
        throw error;
      }
      if (data.organizationId !== organizationId) throw new Error('Stale organization response');
      return normalizeWorkspace(data);
    },
    // Only after this organization's capabilities are ready and allow reading (PRD §11.3).
    enabled: Boolean(identity?.id && activeTenantId && capabilityOrganization === activeTenantId && hasPermission('document.view')),
    staleTime: 10_000,
  });

  const updateData = useCallback(<K extends keyof WorkspaceData>(key: K, action: SetStateAction<WorkspaceData[K]>) => {
    let previousValue: WorkspaceData[K];
    let optimisticValue: WorkspaceData[K];
    const updated = queryClient.setQueryData<WorkspaceData>(queryKey, previous => {
      const current = previous || EMPTY_WORKSPACE;
      const value = typeof action === 'function'
        ? (action as (value: WorkspaceData[K]) => WorkspaceData[K])(current[key])
        : action;
      previousValue = current[key];
      return { ...current, [key]: value };
    });
    optimisticValue = updated![key];
    // A failed request must not overwrite a newer edit or a successful server refresh.
    return () => queryClient.setQueryData<WorkspaceData>(queryKey, current =>
      current && current[key] === optimisticValue ? { ...current, [key]: previousValue } : current);
  }, [queryClient, queryKey]);

  const cancelPendingLoad = useCallback(() => queryClient.cancelQueries({ queryKey, exact: true }), [queryClient, queryKey]);
  const loadAllData = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey, exact: true });
  }, [queryClient, queryKey]);

  const data = query.data || EMPTY_WORKSPACE;
  // Legacy prop shape for views that only show upload availability; no IDs, no secrets.
  const googleConfig = useMemo<GoogleSheetsConfig>(() => ({
    driveFolderId: '', spreadsheetId: '', isConnected: data.services.googleUploadsAvailable, autoSync: false,
  }), [data.services.googleUploadsAvailable]);

  return { ...data, googleConfig, queryKey, updateData, cancelPendingLoad, loadAllData,
    workspaceLoading: query.isFetching && !query.data, workspaceError: query.isError };
}
