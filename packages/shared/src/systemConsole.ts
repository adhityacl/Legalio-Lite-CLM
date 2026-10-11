export const SYSTEM_SUBMENUS = ['dashboard', 'users', 'accounts', 'sessions', 'organizations', 'apikeys', 'google', 'ai', 'smtp', 'ui-texts', 'database', 'backups'] as const;
export type SystemSubmenu = (typeof SYSTEM_SUBMENUS)[number];
export const SYSTEM_TABS = SYSTEM_SUBMENUS.map((tab) => `admin-system-${tab}`);
