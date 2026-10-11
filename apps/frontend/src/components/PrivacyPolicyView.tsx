import React from 'react';
import { Shield } from 'lucide-react';
import { LegalDocument } from './legal/LegalDocument';
import { PRIVACY_CONTENT } from './legal/privacyContent';

interface PrivacyPolicyViewProps {
  onBack?: () => void;
}

const ACCENT = {
  icon: <Shield aria-hidden="true" className="w-g16 h-g16 text-accent-foreground" />,
};

export const PrivacyPolicyView: React.FC<PrivacyPolicyViewProps> = ({ onBack }) => (
  <LegalDocument catalog={PRIVACY_CONTENT} accent={ACCENT} idPrefix="section" onBack={onBack} />
);
