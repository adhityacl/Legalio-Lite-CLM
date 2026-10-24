import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useTenant } from '../../context/TenantContext';
import { useTenantSettings } from '../../context/TenantSettingsContext';
import { usePermissions } from '../../lib/permissions';
import type { Contract, InsertionOrder, Partner } from '@legalio/types';
import { buildDocumentCalendarEvents } from './calendarModel';
import { DocumentCalendar } from './DocumentCalendar';
import type { CalendarEvent } from './eventTypes';
import { useObligationEvents } from '../obligations/useObligationEvents';

export function WorkspaceDocumentCalendar({ contracts, ios, partners, loading, error, onRetry, onOpenDocument, onOpenObligation }: {
  contracts: Contract[]; ios: InsertionOrder[]; partners: Partner[];
  loading?: boolean; error?: boolean; onRetry?: () => void;
  onOpenDocument: (kind: 'contract' | 'io', id: string) => void;
  /** When given, the organization's open obligations appear on the calendar too (opened with this callback). */
  onOpenObligation?: (id: string) => void;
}) {
  const { user } = useAuth();
  const { activeTenantId } = useTenant();
  const { policy } = useTenantSettings();
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canView = !permissionsLoading && hasPermission('document.view');
  const commercialEnabled = policy.settings.modules.commercialDocuments;
  const [range, setRange] = useState<{ start: Date; end: Date } | null>(null);
  const onRangeChange = useCallback((start: Date, end: Date) => setRange((previous) => (previous && previous.start.getTime() === start.getTime() && previous.end.getTime() === end.getTime() ? previous : { start, end })), []);
  const obligations = useObligationEvents(range, canView && Boolean(onOpenObligation));
  const documentEvents = useMemo(() => canView
    ? buildDocumentCalendarEvents(contracts, commercialEnabled ? ios : [], partners, user, activeTenantId)
    : [], [canView, contracts, commercialEnabled, ios, partners, user, activeTenantId]);
  const events = useMemo(() => [...documentEvents, ...obligations.events], [documentEvents, obligations.events]);
  const onEventClick = (event: CalendarEvent) => {
    if (!canView || !event.documentId || !events.some(item => item.id === event.id)) return;
    if (event.documentKind === 'obligation') onOpenObligation?.(event.documentId);
    else if (event.documentKind) onOpenDocument(event.documentKind, event.documentId);
  };
  return <DocumentCalendar key={activeTenantId} events={events} loading={loading || permissionsLoading} error={error || obligations.isError} onRetry={onRetry} onEventClick={onEventClick} onRangeChange={onRangeChange} />;
}
