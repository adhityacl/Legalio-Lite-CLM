import React from 'react';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import {
  Users,
  Radio,
  Building2,
  Layers,
  ShieldCheck,
  KeyRound,
  Plus,
  Clock,
  ArrowUpRight,
  ExternalLink,
} from 'lucide-react';
import {
  ConsoleMetrics,
  ConsoleOrganization,
  ConsoleSession,
  ConsoleSubmenu,
  ConsoleUser,
} from './types';
import { useLanguage } from '../../context/LanguageContext';

interface AdminDashboardTabProps {
  metrics: ConsoleMetrics | null;
  activeOrg: ConsoleOrganization | null;
  recentUsers: ConsoleUser[];
  recentSessions: ConsoleSession[];
  onNavigateTab: (tab: ConsoleSubmenu) => void;
  onOpenCreateOrg: () => void;
  onOpenCreateTeam: () => void;
  onOpenCreateApiKey: () => void;
  onRevokeSession: (sessionId: string) => void;
}

export const AdminDashboardTab: React.FC<AdminDashboardTabProps> = ({
  metrics,
  activeOrg,
  recentUsers,
  recentSessions,
  onNavigateTab,
  onOpenCreateOrg,
  onOpenCreateTeam,
  onOpenCreateApiKey,
  onRevokeSession,
}) => {
  const { t, language } = useLanguage();
  const activeSessions = recentSessions.filter((session) => new Date(session.expiresAt) >= new Date());

  const statCards = [
    {
      label: t('admin.card_total_users', 'Total Pengguna'),
      value: metrics?.totalUsers ?? 0,
      sub: `${metrics?.activeUsers ?? 0} ${t('admin.status_active', 'aktif')}, ${metrics?.bannedUsers ?? 0} ${t('admin.status_banned', 'dicekal')}`,
      icon: Users,
      tab: 'users' as ConsoleSubmenu,
      accent: 'emerald',
    },
    {
      label: t('admin.card_active_sessions', 'Sesi Aktif'),
      value: metrics?.activeSessions ?? 0,
      sub: t('admin.sub_valid_tokens', 'Token valid realtime'),
      icon: Radio,
      tab: 'sessions' as ConsoleSubmenu,
      accent: 'blue',
      pulse: true,
    },
    {
      label: t('admin.card_enterprise_orgs', 'Organisasi Enterprise'),
      value: metrics?.totalOrgs ?? 0,
      sub: activeOrg ? `${t('admin.active_prefix', 'Aktif:')} ${activeOrg.name}` : t('admin.sub_tenant_isolate', 'Multi-tenant isolate'),
      icon: Building2,
      tab: 'organizations' as ConsoleSubmenu,
      accent: 'purple',
    },
    {
      label: t('admin.card_departments_teams', 'Departemen / Teams'),
      value: metrics?.totalTeams ?? 0,
      sub: 'Legal, Finance, Commercial',
      icon: Layers,
      tab: 'teams' as ConsoleSubmenu,
      accent: 'amber',
    },
    {
      label: t('admin.card_verified_accounts', 'Akun Terverifikasi'),
      value: metrics?.verifiedUsers ?? 0,
      sub: `${metrics?.credentialAccounts ?? 0} Password / ${metrics?.googleAccounts ?? 0} Google`,
      icon: ShieldCheck,
      tab: 'users' as ConsoleSubmenu,
      accent: 'teal',
    },
    {
      label: t('admin.card_active_apikeys', 'API Keys Aktif'),
      value: metrics?.totalApiKeys ?? 0,
      sub: t('admin.sub_machine_integration', 'Integrasi mesin & webhook'),
      icon: KeyRound,
      tab: 'apikeys' as ConsoleSubmenu,
      accent: 'slate',
    },
  ];

  return (
    <div className="space-y-6">
      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 ds-grid">
        {statCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              onClick={() => onNavigateTab(card.tab)}
              className="ds-panel p-4 transition-all cursor-pointer group"
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-ink-soft">
                  {card.label}
                </span>
                <div className="ds-icon-tile ds-icon-tile-sm bg-surface text-ink-soft group-hover:bg-status-success-soft group-hover:text-status-success dark:group-hover:bg-status-success-soft/50 dark:group-hover:text-status-success transition-colors">
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-ink tabular-nums">
                  {card.value}
                </span>
                {card.pulse && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-status-success">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-success animate-ping" />
                    {t('admin.online_status', 'Online')}
                  </span>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-ink-soft">
                <span className="truncate">{card.sub}</span>
                <ArrowUpRight className="w-3.5 h-3.5 text-ink-soft group-hover:text-ink-soft dark:group-hover:text-ink transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </div>
            </div>
          );
        })}
      </div>

      {/* Two Columns: Recent Users & Recent Sessions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 ds-grid">
        {/* Recent Users Card */}
        <div className="rounded-xl border border-hairline bg-surface overflow-hidden shadow-xs">
          <div className="ds-section-header">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-status-success" />
              <h3 className="text-sm font-semibold text-ink">
                {t('admin.recent_users_title', 'Pengguna Terbaru')}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('users')}
              className="text-xs font-medium text-status-success hover:text-status-success flex items-center gap-1"
            >
              {t('admin.view_all', 'Lihat Semua')}
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>

          <div className="divide-y divide-hairline">
            {recentUsers.length === 0 ? (
              <div className="p-6 text-center text-xs text-ink-soft">
                {t('admin.no_users_found', 'Belum ada pengguna terdaftar.')}
              </div>
            ) : (
              recentUsers.slice(0, 5).map((user) => (
                <div
                  key={user.id}
                  className="p-3.5 flex items-center justify-between hover:bg-surface dark:hover:bg-surface-2/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-surface-2 flex items-center justify-center text-ink font-semibold text-xs shrink-0">
                      {user.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="truncate">
                      <div className="font-medium text-xs text-ink truncate">
                        {user.name}
                      </div>
                      <div className="text-xs text-ink-soft truncate">
                        {user.email}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        user.role === 'superuser'
                          ? 'bg-status-danger-soft text-status-danger dark:bg-status-danger-soft/60 '
                          : user.role === 'admin'
                          ? 'bg-status-special-soft text-status-special dark:bg-status-special-soft/60 '
                          : user.role === 'manager' || user.role === 'legal'
                          ? 'bg-status-info-soft text-status-info dark:bg-status-info-soft/60 '
                          : user.role === 'editor' || user.role === 'finance'
                          ? 'bg-status-success-soft text-status-success dark:bg-status-success-soft/60 '
                          : 'bg-surface-2 text-ink '
                      }`}
                    >
                      {user.role.toUpperCase()}
                    </span>
                    {user.banned ? (
                      <span className="text-xs px-1.5 py-0.5 rounded-sm bg-status-danger-soft text-status-danger dark:bg-status-danger-soft/60 font-medium">
                        {t('admin.status_banned', 'Dicekal')}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-soft">
                        {new Date(user.createdAt).toLocaleDateString(getActiveFormattingLocale(), {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </span>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recent Active Sessions Card */}
        <div className="rounded-xl border border-hairline bg-surface overflow-hidden shadow-xs">
          <div className="ds-section-header">
            <div className="flex items-center gap-2">
              <Radio className="w-4 h-4 text-status-info" />
              <h3 className="text-sm font-semibold text-ink">
                {t('admin.active_login_sessions_title', 'Sesi Login Aktif')}
              </h3>
            </div>
            <button
              type="button"
              onClick={() => onNavigateTab('sessions')}
              className="text-xs font-medium text-status-success hover:text-status-success flex items-center gap-1"
            >
              {t('admin.view_all', 'Lihat Semua')} ({activeSessions.length})
              <ArrowUpRight className="w-3 h-3" />
            </button>
          </div>

          <div className="divide-y divide-hairline">
            {activeSessions.length === 0 ? (
              <div className="p-6 text-center text-xs text-ink-soft">
                {t('admin.no_sessions_found', 'Tidak ada sesi login aktif saat ini.')}
              </div>
            ) : (
              activeSessions.slice(0, 5).map((session) => (
                <div
                  key={session.id}
                  className="p-3.5 flex items-center justify-between hover:bg-surface dark:hover:bg-surface-2/50 transition-colors"
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-xs text-ink">
                        {session.userName || t('admin.generic_user', 'Pengguna')}
                      </span>
                      <span className="text-xs font-mono px-1.5 py-0.2 rounded-sm bg-surface-2 text-ink-soft">
                        {session.ipAddress || t('admin.not_available', 'Tidak tersedia')}
                      </span>
                    </div>
                    <div className="text-xs text-ink-soft truncate mt-0.5 font-mono">
                      {t('admin.token', 'Token:')} {session.token ? `${session.token.slice(0, 10)}...` : (session.id || '').slice(0, 10)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-ink-soft hidden sm:inline">
                      {t('admin.expires_prefix', 'Kadaluarsa:')} {new Date(session.expiresAt).toLocaleDateString(getActiveFormattingLocale())}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRevokeSession(session.id)}
                      className="inline-flex items-center px-2 min-h-8 rounded-sm text-xs font-semibold text-status-danger hover:bg-status-danger-soft dark:hover:bg-status-danger-soft/50 transition-colors"
                      title={t('admin.btn_revoke_session', 'Cabut sesi login ini')}
                    >
                      {t('admin.btn_revoke', 'Cabut')}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
