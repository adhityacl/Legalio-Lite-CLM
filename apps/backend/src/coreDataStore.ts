import type Database from 'better-sqlite3';

export function normalizeSqliteId(row: any, fallback: string) {
  if (row?.id) return String(row.id);
  if (row?.contract_id) return String(row.contract_id);
  if (row?.partner_id) return String(row.partner_id);
  if (row?.io_id) return String(row.io_id);
  if (row?.email) return String(row.email);
  if (row?.templateId) return String(row.templateId);
  if (row?.tenantId) return String(row.tenantId);
  if (row?.name) return String(row.name);
  return fallback;
}

export function isValidAllowedUserRow(row: any) {
  if (!row || typeof row !== 'object') return false;
  const email = String(row.email || row.emailAddress || row.userEmail || '').trim();
  return email.length > 0;
}

export function synchronizeCoreData(sqliteDb: Database.Database, data: any) {
  if (!data || typeof data !== 'object') return;

  const syncTable = (table: string, rows: any[] = []) => {
    sqliteDb.transaction(() => {
      const existing = new Map((sqliteDb.prepare(`SELECT id, payload FROM ${table}`).all() as { id: string; payload: string }[])
        .map(row => [row.id, row.payload]));
      const seen = new Set<string>();
      const isUserTable = table === 'allowed_users';
      const remove = sqliteDb.prepare(`DELETE FROM ${table} WHERE id = ?`);
      // Remove changed users first so valid email swaps retain the previous full-replacement behavior.
      if (isUserTable) {
        const incoming = new Map(rows.filter(isValidAllowedUserRow).map(row => [normalizeSqliteId(row, ''), JSON.stringify(row)]));
        for (const [id, payload] of existing) if (incoming.get(id) !== payload) remove.run(id);
      }
      const columns = isUserTable
        ? ['id', 'email', 'name', 'role', 'status', 'organizationId', 'payload', 'createdAt', 'updatedAt']
        : ['id', 'organizationId', 'payload', 'createdAt', 'updatedAt'];
      const insert = sqliteDb.prepare(`INSERT INTO ${table} (${columns.join(', ')})
        VALUES (${columns.map(column => `@${column}`).join(', ')})
        ON CONFLICT(id) DO UPDATE SET ${columns.slice(1).map(column => `${column}=excluded.${column}`).join(', ')}`);
      for (const row of Array.isArray(rows) ? rows : []) {
        if (isUserTable && !isValidAllowedUserRow(row)) continue;
        const id = normalizeSqliteId(row, `${table}-${Math.random().toString(36).slice(2, 10)}`);
        if (seen.has(id)) throw new Error(`Duplicate id in ${table}: ${id}`);
        seen.add(id);
        const payload = JSON.stringify(row);
        if (existing.get(id) === payload) continue;
        const record = {
          id, organizationId: row?.organizationId ?? null, payload,
          createdAt: row?.createdAt ?? row?.created_at ?? new Date().toISOString(),
          updatedAt: row?.updatedAt ?? row?.updated_at ?? new Date().toISOString(),
        };
        insert.run(isUserTable ? {
          ...record, email: String(row.email || row.emailAddress || row.userEmail || '').trim(),
          name: row.name ?? row.fullName ?? null, role: row.role ?? null, status: row.status ?? null,
        } : record);
      }
      for (const id of existing.keys()) if (!seen.has(id)) remove.run(id);
    })();
  };

  syncTable('allowed_users', Array.isArray(data.allowedUsers) ? data.allowedUsers.filter(isValidAllowedUserRow) : []);
  syncTable('partners', Array.isArray(data.partners) ? data.partners : []);
  syncTable('contracts', Array.isArray(data.contracts) ? data.contracts : []);
  syncTable('insertion_orders', Array.isArray(data.ios) ? data.ios : []);
  syncTable('notifications', Array.isArray(data.notifications) ? data.notifications : []);
  syncTable('activity_logs', Array.isArray(data.activityLogs) ? data.activityLogs : []);
  syncTable('evaluations', Array.isArray(data.evaluations) ? data.evaluations : []);
  syncTable('spendings', Array.isArray(data.spendings) ? data.spendings : []);
  // `tenants`/`departments` are legacy projections of the canonical
  // organization/team rows (tenant-boundaries PRD §7.3): never snapshot-
  // replaced from memory, so they stay intact as migration input.
  syncTable('templates', Array.isArray(data.templates) ? data.templates : []);

  if (data.branding) {
    sqliteDb.prepare(`
      INSERT INTO branding (id, organizationId, payload, updatedAt)
      VALUES (@id, @organizationId, @payload, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        organizationId = excluded.organizationId,
        payload = excluded.payload,
        updatedAt = excluded.updatedAt
      WHERE branding.payload IS NOT excluded.payload
    `).run({
      id: 'branding',
      organizationId: data.branding.organizationId ?? null,
      payload: JSON.stringify(data.branding),
      updatedAt: new Date().toISOString(),
    });
  }

  const googleConfigPayload = data.googleConfig ?? data.appSettings ?? null;
  if (googleConfigPayload) {
    sqliteDb.prepare(`
      INSERT INTO app_settings (id, organizationId, payload, updatedAt)
      VALUES (@id, @organizationId, @payload, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        organizationId = excluded.organizationId,
        payload = excluded.payload,
        updatedAt = excluded.updatedAt
      WHERE app_settings.payload IS NOT excluded.payload
    `).run({
      id: 'google_config',
      organizationId: googleConfigPayload.organizationId ?? null,
      payload: JSON.stringify(googleConfigPayload),
      updatedAt: new Date().toISOString(),
    });
  }

  if (data.newsTicker) {
    sqliteDb.prepare(`
      INSERT INTO news_ticker (id, payload, updatedAt)
      VALUES (@id, @payload, @updatedAt)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        updatedAt = excluded.updatedAt
      WHERE news_ticker.payload IS NOT excluded.payload
    `).run({
      id: 'default',
      payload: JSON.stringify(data.newsTicker),
      updatedAt: new Date().toISOString(),
    });
  }
}
