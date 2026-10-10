/**
 * Default `npm run test:e2e`: the same isolated live suite as
 * `npm run test:e2e:tenant-boundaries` (temporary database and storage,
 * synthetic fixtures). It never seeds or opens the workspace auth.db.
 * Mocked-API browser checks: `npm run test:e2e:fixtures`.
 *
 *   npx playwright install        # one-time, downloads browser binaries
 *   npm run test:e2e
 */
export { default } from './playwright.tenant-boundaries.config';
