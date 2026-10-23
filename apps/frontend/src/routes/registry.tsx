import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { SETTINGS_TABS } from '../lib/appRoutes';

/**
 * The page registry: every workspace tab (`?tab=`) and the lazy-loaded component that renders it. Pages are split into their own
 * chunks, loaded only when visited; the route gate (lib/appRoutes.ts `resolveRoute`, permissions, modules) has already allowed the tab
 * before anything here mounts. A tab without an entry renders nothing (the gate redirects or denies unknown tabs).
 */
export type ModuleFlag = 'commercialDocuments' | 'spending' | 'evaluation';

export interface RouteDef {
  component: LazyExoticComponent<ComponentType<any>>;
  props?: Record<string, unknown>;
  /** Tenant module that must be enabled for the page to be reachable. */
  module?: ModuleFlag;
}

const dashboard = lazy(() => import('./DashboardRoute'));
const hierarchy = lazy(() => import('./HierarchyRoute'));
const contracts = lazy(() => import('./ContractsRoute'));
const contractCreator = lazy(() => import('./ContractCreatorRoute'));
const approvals = lazy(() => import('./ApprovalRoute'));
const orders = lazy(() => import('./OrdersRoute'));
const partners = lazy(() => import('./PartnersRoute'));
const spending = lazy(() => import('./SpendingRoute'));
const notifications = lazy(() => import('./NotificationsRoute'));
const bulkImport = lazy(() => import('./BulkImportRoute'));
const settings = lazy(() => import('./SettingsRoute'));
const privacy = lazy(() => import('./LegalRoutes').then((m) => ({ default: m.PrivacyRoute })));
const terms = lazy(() => import('./LegalRoutes').then((m) => ({ default: m.TermsRoute })));

export const ROUTES: Record<string, RouteDef> = {
  dashboard: { component: dashboard },
  hierarchy: { component: hierarchy },
  contracts: { component: contracts },
  'create-contract': { component: contractCreator },
  'document-approval': { component: approvals },
  ios: { component: orders, module: 'commercialDocuments' },
  io: { component: orders, module: 'commercialDocuments' },
  partners: { component: partners },
  'partner-evaluation': { component: partners, props: { evaluation: true }, module: 'evaluation' },
  'partner-spending': { component: spending, module: 'spending' },
  notifikasi: { component: notifications },
  'bulk-import': { component: bulkImport },
  privacy: { component: privacy },
  terms: { component: terms },
  ...Object.fromEntries(SETTINGS_TABS.map((tab) => [tab, { component: settings }])),
};

/** True when the tab's tenant module is switched off (the page is then not available, whatever the role). */
export function moduleDisabled(tab: string, modules: Partial<Record<ModuleFlag, boolean>>): boolean {
  const flag = ROUTES[tab]?.module;
  return Boolean(flag) && !modules[flag as ModuleFlag];
}

/** Which kind of record a `&id=` deep link names on each tab. */
export const RECORD_TABS: Record<string, 'contract' | 'io' | 'spending' | 'evaluation' | 'partner'> = {
  contracts: 'contract',
  ios: 'io',
  io: 'io',
  'partner-spending': 'spending',
  'partner-evaluation': 'evaluation',
  partners: 'partner',
};
