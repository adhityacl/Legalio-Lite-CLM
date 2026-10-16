import React, { lazy, Suspense, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { DocumentExplorer } from './documents/DocumentExplorer';
import { NewDocumentDialog, type NewDocumentChoice } from './documents/NewDocumentDialog';
import type { ContractCreatorViewProps } from '../features/documents/ContractDocumentEditor';

const DocumentEditor = lazy(() => import('../features/documents/ContractDocumentEditor').then(m => ({ default: m.ContractDocumentEditor })));

export const ContractCreatorView: React.FC<ContractCreatorViewProps> = (props) => {
  const { isEditor: canEdit } = useAuth();
  const { t } = useLanguage();
  // `?document=<id>` opens that document straight in the editor (My Approval opens it in a new tab).
  const [editorRequest, setEditorRequest] = useState<{ documentId: string | null; template?: NewDocumentChoice } | null>(() => {
    const documentId = new URLSearchParams(window.location.search).get('document');
    return documentId ? { documentId } : null;
  });
  // Drop the param once read, so later tab switches (which keep other query params) don't reopen it.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('document')) return;
    url.searchParams.delete('document');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  const [choosingTemplate, setChoosingTemplate] = useState(false);

  if (!editorRequest) {
    return <>
      <DocumentExplorer canEdit={canEdit} canDelete={canEdit}
        onOpen={documentId => setEditorRequest({ documentId })}
        onCreate={() => setChoosingTemplate(true)} />
      {choosingTemplate && <NewDocumentDialog
        onSelect={template => { setChoosingTemplate(false); setEditorRequest({ documentId: null, template }); }}
        onClose={() => setChoosingTemplate(false)} />}
    </>;
  }

  return <Suspense fallback={<div role="status" className="flex min-h-g233 items-center justify-center text-sm text-muted-foreground">{t('common.loading', 'Loading…')}</div>}>
    <DocumentEditor {...props} initialDocumentId={editorRequest.documentId} initialTemplate={editorRequest.template} />
  </Suspense>;
};
