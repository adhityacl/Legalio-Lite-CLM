import { api } from './client';

export const accountApi = {
  /** First organization of a signed-in user without one. */
  createOrganization: (profile: Record<string, unknown>) => api.post<{ success?: boolean }>('/me/organization', profile),
  acceptInvitation: (code: string) => api.post<{ success?: boolean }>(`/invitations/${encodeURIComponent(code)}/accept`),
  changePassword: (input: { currentPassword: string; newPassword: string; revokeOtherSessions?: boolean }) =>
    api.post<{ status?: boolean }>('/auth/change-password', input),
  systemStatus: () => api.get<{ defaultAdminPasswordActive?: boolean; googleSetupIncomplete?: boolean }>('/system/status', { cache: 'no-store' }),
};
