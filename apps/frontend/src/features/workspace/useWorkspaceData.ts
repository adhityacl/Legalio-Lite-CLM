import { useCallback, useMemo, type SetStateAction } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useIdentity } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { useLanguage } from '../../context/LanguageContext';
import { getAuthHeaders } from '../../lib/apiFetch';
import { usePermissions } from '../../lib/permissions';
import type { Contract, InsertionOrder, Partner, NotificationLog, GoogleSheetsConfig, PartnerEvaluation, PartnerSpending } from '@legalio/types';

/** `GET /api/init-data` (tenant-boundaries PRD §11.4). */
interface WorkspaceData {
  organizationId: string;
  contracts: Contract[];
  ios: InsertionOrder[];
  partners: Partner[];
  notifications: NotificationLog[];
  evaluations: PartnerEvaluation[];
  spendings: PartnerSpending[];
  services: { aiAvailable: boolean; googleUploadsAvailable: boolean };
  timestamp: number;
}

/** Absence is empty/unavailable — never another deployment's resources. */
const EMPTY_DATA: WorkspaceData = {
  organizationId: '',
  contracts: [], ios: [], partners: [], notifications: [], evaluations: [], spendings: [],
  services: { aiAvailable: false, googleUploadsAvailable: false },
  timestamp: 0,
};

/** Query cache owns workspace records; UI state stays in the feature views. */
export function useWorkspaceData() {
  const { identity } = useIdentity();
  const { activeTenantId } = useTenant();
  const { t } = useLanguage();
  const { hasPermission, organizationId: capabilityOrganization } = usePermissions();
  const queryClient = useQueryClient();
  const queryKey = useMemo(() => ['init-data', identity?.id, activeTenantId], [identity?.id, activeTenantId]);
  const query = useQuery<WorkspaceData>({
    queryKey,
    queryFn: async ({ signal }) => {
      // The organization is captured when the request is built; a later switch never changes it.
      const organizationId = activeTenantId;
      const response = await fetch('/api/init-data', { headers: getAuthHeaders(organizationId), cache: 'no-store', signal });
      if (response.status === 404) window.dispatchEvent(new CustomEvent('organization-access-lost', { detail: organizationId }));
      if (!response.ok) throw new Error(t('app.failed_to_fetch_initial_data', 'Failed to fetch initial data'));
      const data = await response.json();
      if (data.organizationId !== organizationId) throw new Error('Stale organization response');
      const normalized: WorkspaceData = { ...EMPTY_DATA, ...data };
      for (const key of ['contracts', 'ios', 'partners', 'notifications', 'evaluations', 'spendings'] as const) {
        if (!Array.isArray(normalized[key])) (normalized as any)[key] = [];
      }
      normalized.timestamp = data.timestamp || Date.now();
      return normalized;
    },
    // Only after this organization's capabilities are ready and allow reading (PRD §11.3).
    enabled: Boolean(identity?.id && activeTenantId && capabilityOrganization === activeTenantId && hasPermission('document.view')),
    staleTime: 10_000,
  });

  const updateData = useCallback(<K extends keyof WorkspaceData>(key: K, action: SetStateAction<WorkspaceData[K]>) => {
    let previousValue: WorkspaceData[K];
    let optimisticValue: WorkspaceData[K];
    const updated = queryClient.setQueryData<WorkspaceData>(queryKey, previous => {
      const current = previous || EMPTY_DATA;
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

  const data = query.data || EMPTY_DATA;
  // Legacy prop shape for views that only show upload availability; no IDs, no secrets.
  const googleConfig = useMemo<GoogleSheetsConfig>(() => ({
    driveFolderId: '', spreadsheetId: '', isConnected: data.services.googleUploadsAvailable, autoSync: false,
  }), [data.services.googleUploadsAvailable]);

  return { ...data, googleConfig, updateData, cancelPendingLoad, loadAllData,
    workspaceLoading: query.isFetching && !query.data, workspaceError: query.isError };
}
