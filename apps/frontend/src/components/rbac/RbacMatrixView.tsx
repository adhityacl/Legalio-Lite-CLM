/**
 * RbacMatrixView — halaman matriks peran × permission.
 *
 * Memakai:
 *  - komponen Obsidian UI yang di-vendor (`components/obsidian/table`, `separator`)
 *  - design token proyek (kelas turunan token: bg-card, text-foreground, border-border, …)
 *  - helper permission frontend (`<Can>`) untuk gating
 *  - data dari endpoint kanonik `GET /api/rbac/matrix` (dihasilkan dari server/rbac.ts)
 *
 * Keadaan yang ditangani: memuat (skeleton), kosong, galat (dengan tombol coba lagi),
 * dan responsif (tabel bisa di-scroll horizontal di layar sempit).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@legalio/ui-components/obsidian/table';
import { Separator } from '@legalio/ui-components/obsidian/separator';
import { Can, usePermissions } from '../../lib/permissions';
import { useLanguage } from '../../context/LanguageContext';

import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Alert, AlertContent } from '@legalio/ui-components/alert';
interface RoleDef { code: string; name: string; level: number; scope: string; description: string }
interface PermDef { code: string; resource: string; action: string }
interface MatrixPayload {
  roles: RoleDef[];
  permissions: PermDef[];
  matrix: Record<string, string[]>;
}

const ROLE_ORDER = ['superuser', 'admin', 'manager', 'editor', 'viewer'];

function roleBadgeClass(role: string): string {
  // Memakai token palet data (muted natural) — bukan warna hardcoded.
  const map: Record<string, string> = {
    superuser: 'bg-[var(--color-data-5)] text-white',
    admin: 'bg-[var(--color-data-1)] text-white',
    manager: 'bg-[var(--color-data-2)] text-white',
    editor: 'bg-[var(--color-data-3)] text-white',
    viewer: 'bg-[var(--color-data-4)] text-white',
  };
  return map[role] ?? 'bg-muted text-muted-foreground';
}

export default function RbacMatrixView() {
  const { t } = useLanguage();
  const [state, setState] = useState<{ status: 'loading' | 'ok' | 'error'; data?: MatrixPayload; message?: string }>({ status: 'loading' });
  const { role } = usePermissions();

  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const token = typeof window !== 'undefined' ? localStorage.getItem('auth_session_token') : null;
      const res = await fetch('/api/rbac/matrix', {
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}`, 'x-session-token': token } : {}),
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as MatrixPayload;
      setState({ status: 'ok', data: json });
    } catch (e) {
      setState({ status: 'error', message: e instanceof Error ? e.message : t('rbac.gagal_memuat_matriks', 'Gagal memuat matriks.') });
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  /* ---------------- memuat ---------------- */
  if (state.status === 'loading') {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6" aria-busy="true" aria-live="polite">
        <div className="h-6 w-56 rounded-sm bg-muted" />
        <div className="mt-2 h-3 w-80 rounded-sm bg-muted" />
        <Card className="mt-6 space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-4 rounded-sm bg-muted" style={{ width: `${90 - i * 4}%` }} />
          ))}
        </Card>
      </div>
    );
  }

  /* ---------------- galat ---------------- */
  if (state.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <Alert status="error" role="alert">
          <AlertContent><p className="font-semibold">{t('rbac.gagal_memuat_matriks_peran', 'Gagal memuat matriks peran')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{state.message}</p>
          <Button variant="ghost"
            type="button"
            onClick={() => void load()}
            className="mt-3"
          >
            {t('common.retry', 'Coba lagi')}
          </Button></AlertContent>
        </Alert>
      </div>
    );
  }

  const roles = (state.data?.roles ?? []).slice().sort((a, b) => a.level - b.level);
  const permissions = state.data?.permissions ?? [];
  const matrix = state.data?.matrix ?? {};

  /* ---------------- kosong ---------------- */
  if (!roles.length || !permissions.length) {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <Card className="p-8 text-center">
          <p className="font-semibold text-foreground">{t('rbac.belum_ada_data_matriks', 'Belum ada data matriks')}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t('rbac.pastikan_endpoint', 'Pastikan endpoint')} <code className="font-mono text-xs">{t('rbac.get_api_rbac_matrix', 'GET /api/rbac/matrix')}</code> {t('rbac.aktif', 'aktif.')}</p>
        </Card>
      </div>
    );
  }

  const roleCols = ROLE_ORDER.filter((r) => roles.some((x) => x.code === r));

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold tracking-tight text-foreground sm:text-xl">{t('rbac.matriks_peran_permission', 'Matriks Peran × Permission')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t('rbac.permission_peran_dihasilkan_dari', '{permissions} permission · {roleCols} peran · dihasilkan dari', { permissions: permissions.length, roleCols: roleCols.length })} <code className="font-mono text-xs">{t('rbac.server_rbac_ts', 'server/rbac.ts')}</code>
          </p>
        </div>
        <Can permission="admin.access" fallback={<span className="rounded-full border border-border bg-muted px-3 py-1 text-xs text-muted-foreground">{t('rbac.hanya_baca', 'Hanya baca')}</span>}>
          <span className="rounded-full border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-primary px-3 py-1 text-xs font-semibold text-accent-foreground">
            {t('rbac.akses_admin', 'Akses admin')}
          </span>
        </Can>
      </header>

      <Separator className="my-4" />

      <section aria-label={t('rbac.ringkasan_peran', 'Ringkasan peran')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {roles.map((r) => (
          <Card key={r.code} className="p-3 transition-shadow">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm text-foreground">{r.name}</strong>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${roleBadgeClass(r.code)}`}>{t('rbac.level', 'level {level}', { level: r.level })}</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{r.scope}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-mono">{matrix[r.code]?.length ?? 0}</span> {t('rbac.permission', 'permission')}
            </p>
          </Card>
        ))}
      </section>

      <section aria-label={t('rbac.tabel_matriks', 'Tabel matriks')} className="mt-6">
        <div className="rounded-[var(--radius-xl)] border border-border bg-card shadow-elevated">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{t('rbac.permission_2', 'Permission')}</TableHead>
                <TableHead scope="col">{t('rbac.resource', 'Resource')}</TableHead>
                {roleCols.map((r) => (
                  <TableHead key={r} scope="col" className="text-center">{r.toUpperCase()}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {permissions.map((p) => (
                <TableRow key={p.code} className="hover:bg-muted">
                  <TableCell><code className="font-mono text-xs text-foreground">{p.code}</code></TableCell>
                  <TableCell className="text-muted-foreground">{p.resource}</TableCell>
                  {roleCols.map((r) => {
                    const allowed = (matrix[r] ?? []).includes(p.code);
                    return (
                      <TableCell key={r} className="text-center">
                        <span
                          className={allowed ? 'font-semibold text-accent-foreground' : 'text-muted-foreground'}
                          aria-label={allowed ? t('rbac.diizinkan_untuk', '{r} diizinkan untuk {code}', { r, code: p.code }) : t('rbac.tidak_diizinkan_untuk', '{r} tidak diizinkan untuk {code}', { r, code: p.code })}
                        >
                          {allowed ? '✔' : '—'}
                        </span>
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {t('rbac.diizinkan_ditolak_matriks_ini_dibaca_dari', '✔ = diizinkan · — = ditolak. Matriks ini dibaca dari endpoint server, bukan hardcode di frontend (peran Anda saat ini:')} <span className="font-mono">{role}</span>).
        </p>
      </section>
    </div>
  );
}
