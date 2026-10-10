import React from 'react';
import { Scale } from 'lucide-react';
import { LegalDocument } from './legal/LegalDocument';
import { TERMS_CONTENT } from './legal/termsContent';

interface TermsOfServiceViewProps {
  onBack?: () => void;
}

const ACCENT = {
  icon: <Scale aria-hidden="true" className="w-4 h-4 text-status-info" />,
  num: 'text-status-info ',
  toc: 'bg-status-info-soft/70  border-status-info-border ',
  tocTitle: 'text-status-info ',
  button: 'bg-status-info hover:bg-status-info',
  link: 'text-status-info ',
};

export const TermsOfServiceView: React.FC<TermsOfServiceViewProps> = ({ onBack }) => (
  <LegalDocument catalog={TERMS_CONTENT} accent={ACCENT} idPrefix="tos" onBack={onBack} />
);
