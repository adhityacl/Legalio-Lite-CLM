import React, { lazy, Suspense, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';

const Chat = lazy(() => import('./AIChatWidget').then(m => ({ default: m.AIChatWidget })));

export function AIChatLauncher() {
  const { t } = useLanguage();
  const [activated, setActivated] = useState(false);
  const label = t('ai_chat.buka_asisten_ai_silegal', 'Buka Asisten AI Legalio');
  const launcher = <div className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-30">
    <button type="button" aria-expanded={false} aria-label={label} title={label} onClick={() => setActivated(true)}
      className="w-13 h-13 rounded-full shadow-xl flex items-center justify-center transition-colors duration-150 cursor-pointer bg-primary text-primary-foreground hover:bg-primary/90">
      <MessageSquare size={22} className="text-white" />
    </button>
  </div>;
  return activated ? <Suspense fallback={launcher}><Chat initiallyOpen /></Suspense> : launcher;
}
