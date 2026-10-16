import React, { useState } from 'react';
import { ApprovalInbox } from './ApprovalInbox';
import { ApprovalForm, type ApprovalDraft } from './ApprovalForm';
import { ApprovalDetail } from './ApprovalDetail';

type Screen = { kind: 'inbox' } | { kind: 'new'; draft?: ApprovalDraft } | { kind: 'detail'; id: string };

/** Document Approval tab: inbox, submission form and detail, switched locally like ContractCreatorView. */
export const ApprovalView: React.FC = () => {
  const [screen, setScreen] = useState<Screen>({ kind: 'inbox' });
  if (screen.kind === 'new') {
    return <ApprovalForm initial={screen.draft} onSubmitted={id => setScreen({ kind: 'detail', id })} onCancel={() => setScreen({ kind: 'inbox' })} />;
  }
  if (screen.kind === 'detail') {
    return <ApprovalDetail id={screen.id} onBack={() => setScreen({ kind: 'inbox' })} onRevise={draft => setScreen({ kind: 'new', draft })} />;
  }
  return <ApprovalInbox onOpen={id => setScreen({ kind: 'detail', id })} onCreate={() => setScreen({ kind: 'new' })} />;
};
