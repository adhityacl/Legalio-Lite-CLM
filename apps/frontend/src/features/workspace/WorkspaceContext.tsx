import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Contract, InsertionOrder, Partner } from '@legalio/types';
import { useTenant } from '../../context/TenantContext';
import { useNavigation } from '../../context/NavigationContext';
import { useWorkspaceData } from './useWorkspaceData';
import { useWorkspaceMutations } from './useWorkspaceMutations';
import { useWorkspaceActions } from './useWorkspaceActions';

type Data = ReturnType<typeof useWorkspaceData>;
type Actions = ReturnType<typeof useWorkspaceActions>;

/** The full-page forms (they replace the list while open). */
export type EditorState =
  | { kind: 'contract'; record: Contract | null }
  | { kind: 'partner'; record: Partner | null }
  | { kind: 'io'; record: InsertionOrder | null }
  | null;

export interface WorkspaceValue extends Data {
  actions: Actions;
  editor: EditorState;
  openEditor: (editor: NonNullable<EditorState>) => void;
  closeEditor: () => void;
  /** Registers a view that needs every record in the browser (editors' pickers, cross-record checks); returns the release function. */
  requestSnapshot: () => () => void;
  amendmentParent: Contract | InsertionOrder | undefined;
  amendmentOpen: boolean;
  openAmendment: (parent?: Contract | InsertionOrder) => void;
  closeAmendment: () => void;
}

const WorkspaceContext = createContext<WorkspaceValue | undefined>(undefined);

/** Workspace records, their optimistic mutations, user-facing actions and the open editor, for the signed-in application. */
export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  // The full `init-data` snapshot is no longer the base of the application: lists, dashboard, badges and search come from the server
  // by page or aggregate. It is loaded only while an editor, the amendment dialog or a view that cross-references records asks for it.
  const [snapshotDemand, setSnapshotDemand] = useState(0);
  const requestSnapshot = useCallback(() => {
    setSnapshotDemand((count) => count + 1);
    let released = false;
    return () => { if (!released) { released = true; setSnapshotDemand((count) => count - 1); } };
  }, []);
  const { activeTenantId } = useTenant();
  const { activeTab } = useNavigation();
  const [editor, setEditor] = useState<EditorState>(null);
  const [amendment, setAmendment] = useState<{ open: boolean; parent?: Contract | InsertionOrder }>({ open: false });
  const data = useWorkspaceData({ enabled: snapshotDemand > 0 || editor !== null || amendment.open });
  const mutations = useWorkspaceMutations(data.queryKey);
  const actions = useWorkspaceActions(mutations, data.loadAllData);

  // The contract, service order and partner forms are pages: leaving via the sidebar, or switching organization, closes them.
  useEffect(() => { setEditor(null); }, [activeTab, activeTenantId]);

  const value = useMemo<WorkspaceValue>(() => ({
    ...data,
    actions,
    editor,
    requestSnapshot,
    openEditor: setEditor,
    closeEditor: () => setEditor(null),
    amendmentOpen: amendment.open,
    amendmentParent: amendment.parent,
    openAmendment: (parent) => setAmendment({ open: true, parent }),
    closeAmendment: () => setAmendment({ open: false }),
  }), [data, actions, editor, amendment, requestSnapshot]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
};

export function useWorkspace(): WorkspaceValue {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('useWorkspace must be used within a WorkspaceProvider');
  return context;
}

/** Keeps the full workspace snapshot loaded while `active` is true (see `requestSnapshot`). */
export function useSnapshotDemand(active = true) {
  const { requestSnapshot } = useWorkspace();
  useEffect(() => (active ? requestSnapshot() : undefined), [active, requestSnapshot]);
}
