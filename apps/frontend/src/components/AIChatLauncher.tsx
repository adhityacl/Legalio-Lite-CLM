import React, { lazy, Suspense, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';

const Chat = lazy(() => import('./AIChatWidget').then(m => ({ default: m.AIChatWidget })));

export function AIChatLauncher() {
  const { t } = useLanguage();
  const [activated, setActivated] = useState(false);
  const label = t('ai_chat.buka_asisten_ai_silegal', 'Buka Asisten AI Legalio');
  const launcher = <div className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-30">
    <Button size="icon-lg" aria-expanded={false} aria-label={label} title={label} onClick={() => setActivated(true)} className="size-13 rounded-full shadow-lg">
      <MessageSquare className="size-5" aria-hidden="true" />
    </Button>
  </div>;
  return activated ? <Suspense fallback={launcher}><Chat initiallyOpen /></Suspense> : launcher;
}
