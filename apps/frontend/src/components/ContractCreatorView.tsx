import React, { lazy, Suspense, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { DocumentExplorer } from './documents/DocumentExplorer';
import { NewDocumentDialog, type NewDocumentChoice } from './documents/NewDocumentDialog';
import type { ContractCreatorViewProps } from '../features/documents/ContractDocumentEditor';

const DocumentEditor = lazy(() => import('../features/documents/ContractDocumentEditor').then(m => ({ default: m.ContractDocumentEditor })));

export const ContractCreatorView: React.FC<ContractCreatorViewProps> = (props) => {
  const { isEditor: canEdit } = useAuth();
  const { t } = useLanguage();
  const [editorRequest, setEditorRequest] = useState<{ documentId: string | null; template?: NewDocumentChoice } | null>(null);
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

  return <Suspense fallback={<div role="status" className="flex min-h-56 items-center justify-center text-sm text-ink-soft">{t('common.loading', 'Loading…')}</div>}>
    <DocumentEditor {...props} initialDocumentId={editorRequest.documentId} initialTemplate={editorRequest.template} />
  </Suspense>;
};
