export const SYSTEM_SUBMENUS = ['dashboard', 'users', 'accounts', 'sessions', 'organizations', 'apikeys', 'google', 'google-drive', 'google-credentials', 'ai', 'smtp', 'mailer', 'ui-texts', 'reset'] as const;
export type SystemSubmenu = (typeof SYSTEM_SUBMENUS)[number];
export const SYSTEM_TABS = SYSTEM_SUBMENUS.map((tab) => `admin-system-${tab}`);
