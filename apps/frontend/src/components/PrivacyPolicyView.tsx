import React from 'react';
import { Shield } from 'lucide-react';
import { LegalDocument } from './legal/LegalDocument';
import { PRIVACY_CONTENT } from './legal/privacyContent';

interface PrivacyPolicyViewProps {
  onBack?: () => void;
}

const ACCENT = {
  icon: <Shield aria-hidden="true" className="w-4 h-4 text-status-success" />,
  num: 'text-status-success ',
  toc: 'bg-status-success-soft/70 dark:bg-status-success-soft/20 border-status-success-border dark:border-status-success-border/40',
  tocTitle: 'text-status-success ',
  button: 'bg-status-success hover:bg-status-success',
  link: 'text-status-success ',
};

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({ onBack }) => (
  <LegalDocument catalog={PRIVACY_CONTENT} accent={ACCENT} idPrefix="section" onBack={onBack} />
);
