import React from 'react';
import { Scale } from 'lucide-react';
import { LegalDocument } from './legal/LegalDocument';
import { TERMS_CONTENT } from './legal/termsContent';

interface TermsOfServiceViewProps {
  onBack?: () => void;
}

const ACCENT = {
  icon: <Scale aria-hidden="true" className="w-g16 h-g16 text-accent-foreground" />,
};

export const TermsOfServiceView: React.FC<TermsOfServiceViewProps> = ({ onBack }) => (
  <LegalDocument catalog={TERMS_CONTENT} accent={ACCENT} idPrefix="tos" onBack={onBack} />
);
