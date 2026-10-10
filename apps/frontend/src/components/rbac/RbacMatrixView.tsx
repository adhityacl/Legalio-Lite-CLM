/**
 * RbacMatrixView — halaman matriks peran × permission.
 *
 * Memakai:
 *  - komponen moduix (Table, Card, Badge, Alert, Empty, Skeleton) dari @legalio/ui-components
 *  - helper permission frontend (`<Can>`) untuk gating
 *  - data dari endpoint kanonik `GET /api/rbac/matrix` (dihasilkan dari server/rbac.ts)
 *
 * Keadaan yang ditangani: memuat (skeleton), kosong, galat (dengan tombol coba lagi),
 * dan responsif (tabel bisa di-scroll horizontal di layar sempit).
 */
import { useCallback, useEffect, useState } from 'react';
import { Table, TableHeader, TableBody, TableColumnHeader, TableRow, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Separator } from '@legalio/ui-components/separator';
import { Button } from '@legalio/ui-components/button';
import { Card, CardBody, CardDescription, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator, AlertTitle } from '@legalio/ui-components/alert';
import { Badge, type StatusTone } from '@legalio/ui-components/badge';
import { Empty, EmptyContent, EmptyDescription, EmptyTitle } from '@legalio/ui-components/empty';
import { Heading } from '@legalio/ui-components/heading';
import { Skeleton } from '@legalio/ui-components/skeleton';
import { Text } from '@legalio/ui-components/text';
import { Can, usePermissions } from '../../lib/permissions';
import { useLanguage } from '../../context/LanguageContext';
interface RoleDef { code: string; name: string; level: number; scope: string; description: string }
interface PermDef { code: string; resource: string; action: string }
interface MatrixPayload {
  roles: RoleDef[];
  permissions: PermDef[];
  matrix: Record<string, string[]>;
}

const ROLE_ORDER = ['superuser', 'admin', 'manager', 'editor', 'viewer'];

const ROLE_TONE: Record<string, StatusTone> = { superuser: 'special', admin: 'info', manager: 'finance', editor: 'success', viewer: 'neutral' };

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
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 p-4 sm:p-6" aria-busy="true" aria-live="polite">
        <Skeleton height={24} width={224} />
        <Skeleton height={12} width={320} />
        <Card className="mt-3"><CardBody className="grid gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} height={16} width={`${90 - i * 4}%`} />)}</CardBody></Card>
      </div>
    );
  }

  /* ---------------- galat ---------------- */
  if (state.status === 'error') {
    return (
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <Alert status="error" role="alert">
          <AlertIndicator />
          <AlertContent>
            <AlertTitle>{t('rbac.gagal_memuat_matriks_peran', 'Gagal memuat matriks peran')}</AlertTitle>
            <AlertDescription>{state.message}</AlertDescription>
          </AlertContent>
          <AlertActions><Button variant="outline" size="sm" onClick={() => void load()}>{t('common.retry', 'Coba lagi')}</Button></AlertActions>
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
        <Card>
          <Empty>
            <EmptyContent>
              <EmptyTitle>{t('rbac.belum_ada_data_matriks', 'Belum ada data matriks')}</EmptyTitle>
              <EmptyDescription>{t('rbac.pastikan_endpoint', 'Pastikan endpoint')} <code className="font-mono">{t('rbac.get_api_rbac_matrix', 'GET /api/rbac/matrix')}</code> {t('rbac.aktif', 'aktif.')}</EmptyDescription>
            </EmptyContent>
          </Empty>
        </Card>
      </div>
    );
  }

  const roleCols = ROLE_ORDER.filter((r) => roles.some((x) => x.code === r));

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading as="h1" size="lg" weight="semibold">{t('rbac.matriks_peran_permission', 'Matriks Peran × Permission')}</Heading>
          <Text size="sm" tone="muted" className="mt-1">
            {t('rbac.permission_peran_dihasilkan_dari', '{permissions} permission · {roleCols} peran · dihasilkan dari', { permissions: permissions.length, roleCols: roleCols.length })} <code className="font-mono text-xs">{t('rbac.server_rbac_ts', 'server/rbac.ts')}</code>
          </Text>
        </div>
        <Can permission="admin.access" fallback={<Badge tone="neutral">{t('rbac.hanya_baca', 'Hanya baca')}</Badge>}>
          <Badge tone="info">{t('rbac.akses_admin', 'Akses admin')}</Badge>
        </Can>
      </header>

      <Separator className="my-4" />

      <section aria-label={t('rbac.ringkasan_peran', 'Ringkasan peran')} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {roles.map((r) => (
          <Card key={r.code} size="sm">
            <CardHeader>
              <CardTitle className="text-sm">{r.name}</CardTitle>
              <CardDescription>{r.scope}</CardDescription>
              <Badge tone={ROLE_TONE[r.code] ?? 'neutral'} className="col-start-2 row-span-2 row-start-1 self-start">{t('rbac.level', 'level {level}', { level: r.level })}</Badge>
            </CardHeader>
            <CardBody><span className="font-mono">{matrix[r.code]?.length ?? 0}</span> {t('rbac.permission', 'permission')}</CardBody>
          </Card>
        ))}
      </section>

      <section aria-label={t('rbac.tabel_matriks', 'Tabel matriks')} className="mt-6">
        <Card className="overflow-hidden">
          <TableScrollArea>
            <Table interactive>
              <TableHeader>
                <TableRow>
                  <TableColumnHeader scope="col">{t('rbac.permission_2', 'Permission')}</TableColumnHeader>
                  <TableColumnHeader scope="col">{t('rbac.resource', 'Resource')}</TableColumnHeader>
                  {roleCols.map((r) => <TableColumnHeader key={r} scope="col" className="text-center">{r.toUpperCase()}</TableColumnHeader>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {permissions.map((p) => (
                  <TableRow key={p.code}>
                    <TableCell><code className="font-mono text-xs">{p.code}</code></TableCell>
                    <TableCell className="text-muted-foreground">{p.resource}</TableCell>
                    {roleCols.map((r) => {
                      const allowed = (matrix[r] ?? []).includes(p.code);
                      return (
                        <TableCell key={r} className="text-center">
                          <span className={allowed ? 'font-semibold text-accent-foreground' : 'text-muted-foreground'}
                            aria-label={allowed ? t('rbac.diizinkan_untuk', '{r} diizinkan untuk {code}', { r, code: p.code }) : t('rbac.tidak_diizinkan_untuk', '{r} tidak diizinkan untuk {code}', { r, code: p.code })}>
                            {allowed ? '✔' : '—'}
                          </span>
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableScrollArea>
        </Card>
        <Text size="xs" tone="muted" className="mt-3">
          {t('rbac.diizinkan_ditolak_matriks_ini_dibaca_dari', '✔ = diizinkan · — = ditolak. Matriks ini dibaca dari endpoint server, bukan hardcode di frontend (peran Anda saat ini:')} <span className="font-mono">{role}</span>).
        </Text>
      </section>
    </div>
  );
}
