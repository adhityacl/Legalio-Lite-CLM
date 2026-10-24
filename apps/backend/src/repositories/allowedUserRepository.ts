/**
 * The legacy application allowlist (`allowed_users`, one JSON payload per row): explicit INSERT / UPDATE / DELETE per row. It is not
 * part of the in-memory snapshot any more, so an entry added on one instance is seen by every other and a save never deletes
 * entries it does not know. The "at least one Admin" rule is enforced under a transaction-scoped advisory lock.
 */
import { sql, isUniqueViolation, type Sql } from '../db';
import { DuplicateValueError, RecordNotFoundError, RepositoryError } from './errors';

export type AllowedUser = Record<string, any>;
export class LastAdminError extends RepositoryError {
  constructor(message: string) { super(400, 'LAST_ADMIN', message); }
}

const row = (u: AllowedUser) => ({
  id: String(u.id), email: String(u.email).trim().toLowerCase(), name: u.name ?? null, role: u.role ?? null, status: u.status ?? null,
  organizationId: u.organizationId ?? null, payload: JSON.stringify(u),
  createdAt: u.createdAt ?? u.created_at ?? new Date().toISOString(), updatedAt: new Date().toISOString(),
});

export function createAllowedUserRepository(db: Sql) {
  const lockAdmins = () => db.get(`SELECT pg_advisory_xact_lock(hashtextextended('allowed_users:admins', 0))`);
  const parse = (record: { payload: string } | undefined): AllowedUser | undefined => (record ? JSON.parse(record.payload) : undefined);
  const adminCount = async () => Number((await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM allowed_users WHERE role = 'Admin'`))?.n ?? 0);

  return {
    /** Newest first. */
    async list(): Promise<AllowedUser[]> {
      return (await db.all<{ payload: string }>(`SELECT payload FROM allowed_users ORDER BY "createdAt" DESC, id DESC`)).map((r) => JSON.parse(r.payload));
    },
    async get(id: string): Promise<AllowedUser | undefined> {
      return parse(await db.get<{ payload: string }>(`SELECT payload FROM allowed_users WHERE id = ?`, id));
    },
    async findByEmail(email: string): Promise<AllowedUser | undefined> {
      return parse(await db.get<{ payload: string }>(`SELECT payload FROM allowed_users WHERE lower(email) = ?`, email.trim().toLowerCase()));
    },
    async insert(user: AllowedUser): Promise<AllowedUser> {
      const values = row(user);
      try {
        await db.run(`INSERT INTO allowed_users (id, email, name, role, status, "organizationId", payload, "createdAt", "updatedAt")
          VALUES (@id, @email, @name, @role, @status, @organizationId, @payload, @createdAt, @updatedAt)`, values);
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateValueError('email', `Email '${user.email}' sudah ada dalam daftar whitelist.`);
        throw error;
      }
      return user;
    },
    /** Edits one entry under its row lock. `change` may throw (a RepositoryError) to refuse; the demotion of the last Admin is refused here. */
    async mutate(id: string, change: (user: AllowedUser) => void): Promise<AllowedUser> {
      return db.tx(async () => {
        await lockAdmins();
        const current = parse(await db.get<{ payload: string }>(`SELECT payload FROM allowed_users WHERE id = ? FOR UPDATE`, id));
        if (!current) throw new RecordNotFoundError('allowed_users', id);
        const next = { ...current };
        change(next);
        if (current.role === 'Admin' && next.role !== 'Admin' && await adminCount() <= 1) {
          throw new LastAdminError('Sistem membutuhkan minimal 1 akun Admin aktif. Buat Admin lain terlebih dahulu sebelum mengubah role akun ini.');
        }
        const values = row({ ...next, createdAt: current.createdAt });
        await db.run(`UPDATE allowed_users SET name = @name, role = @role, status = @status, payload = @payload, "updatedAt" = @updatedAt WHERE id = @id`, values);
        return next;
      });
    },
    /** Removes an entry; the only Admin cannot be removed. */
    async remove(id: string, guard?: (user: AllowedUser) => void): Promise<AllowedUser> {
      return db.tx(async () => {
        await lockAdmins();
        const current = parse(await db.get<{ payload: string }>(`SELECT payload FROM allowed_users WHERE id = ? FOR UPDATE`, id));
        if (!current) throw new RecordNotFoundError('allowed_users', id);
        guard?.(current);
        if (current.role === 'Admin' && await adminCount() <= 1) throw new LastAdminError('Tidak dapat menghapus satu-satunya akun Admin yang tersisa di sistem.');
        await db.run(`DELETE FROM allowed_users WHERE id = ?`, id);
        return current;
      });
    },
    /** Removes entries by e-mail (the demo accounts of a production start); returns how many went. */
    async removeByEmails(emails: string[]): Promise<number> {
      if (!emails.length) return 0;
      return (await db.run(`DELETE FROM allowed_users WHERE lower(email) = ANY(?)`, emails.map((e) => e.toLowerCase()))).changes;
    },
    async removeAll(): Promise<void> {
      await db.run(`DELETE FROM allowed_users`);
    },
  };
}

/** The application's allowlist repository (the shared SQL facade; its transactions are ambient). */
export const allowedUserRepository = createAllowedUserRepository(sql);
export type AllowedUserRepository = ReturnType<typeof createAllowedUserRepository>;

/**
 * The creator's current name next to each entry (`addedBy`), derived from the other entries when read: nothing is written back, so
 * reading the list never changes the database.
 */
export function withAdderNames<T extends AllowedUser>(users: T[]): T[] {
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [String(u.email).trim().toLowerCase(), u]));
  return users.map((user) => {
    const adder = user.addedByEmail ? byEmail.get(String(user.addedByEmail).trim().toLowerCase()) : undefined;
    if (adder) return { ...user, addedBy: adder.name };
    if (user.addedBy && user.addedBy !== 'System Core' && user.addedBy !== 'System') {
      const wanted = String(user.addedBy).trim().toLowerCase();
      const creator = users.find((c) => String(c.email ?? '').trim().toLowerCase() === wanted || String(c.name ?? '').trim().toLowerCase() === wanted);
      if (creator) return { ...user, addedByEmail: creator.email, addedBy: creator.name };
    }
    return user;
  });
}
