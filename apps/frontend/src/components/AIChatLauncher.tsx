import React, { lazy, Suspense, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';

import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
const Chat = lazy(() => import('./AIChatWidget').then(m => ({ default: m.AIChatWidget })));

export function AIChatLauncher() {
  const { t } = useLanguage();
  const [activated, setActivated] = useState(false);
  const label = t('ai_chat.buka_asisten_ai_silegal', 'Buka Asisten AI Legalio');
  const launcher = <div className="fixed bottom-g13 right-g13 sm:bottom-g26 sm:right-g26 z-30">
    <Tooltip><TooltipTrigger asChild><Button size="icon-lg" aria-expanded={false} aria-label={label} onClick={() => setActivated(true)} className="size-g55 rounded-full shadow-lg">
      <MessageSquare className="size-g21" aria-hidden="true" />
    </Button></TooltipTrigger><TooltipBody>{label}</TooltipBody></Tooltip>
  </div>;
  return activated ? <Suspense fallback={launcher}><Chat initiallyOpen /></Suspense> : launcher;
}
