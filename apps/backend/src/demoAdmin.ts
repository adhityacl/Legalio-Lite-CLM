/** Optional bootstrap/demo administrator configuration read from the environment. */

/*
 * There are no default credentials. The first admin is created on the
 * first-run setup page (POST /api/system/setup). For automated deploys,
 * setting both DEMO_ADMIN_EMAIL and DEMO_ADMIN_PASSWORD pre-creates it
 * instead; SEED_DEMO_ADMIN=false stops that once your own admin exists.
 */
export const demoAdminEmail = (process.env.DEMO_ADMIN_EMAIL || "").trim().toLowerCase();
export const demoAdminPassword = process.env.DEMO_ADMIN_PASSWORD || "";
export const shouldSeedDemoAdmin = process.env.SEED_DEMO_ADMIN !== "false";
// The password older releases seeded the admin with; only kept to warn installs still using it.
export const LEGACY_DEFAULT_ADMIN_PASSWORD = "123456789";
