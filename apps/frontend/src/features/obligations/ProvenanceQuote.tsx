import React from 'react';
import { AlertTriangle, Quote } from 'lucide-react';
import { Badge } from '@legalio/ui-components/badge';
import { Text } from '@legalio/ui-components/text';
import { useLanguage } from '../../context/LanguageContext';

/** Where an AI-extracted value came from: the quote, its page, how sure the model was, and whether the quote was found in the document. */
export const ProvenanceQuote: React.FC<{ quote: string | null; page: number | null; confidence: number | null; verified: boolean | null }> = ({ quote, page, confidence, verified }) => {
  const { t } = useLanguage();
  if (!quote) return null;
  const pct = confidence == null ? null : Math.round(confidence * 100);
  return (
    <figure className="space-y-g5 rounded-md border border-border bg-muted/40 p-g13">
      <blockquote className="flex gap-g8 text-sm italic text-foreground"><Quote className="mt-g3 size-g13 shrink-0 text-muted-foreground" aria-hidden /><span>“{quote}”</span></blockquote>
      <figcaption className="flex flex-wrap items-center gap-g8">
        <Text as="span" size="xs" tone="muted">{page ? t('obligations.source_page', 'Page {page}', { page }) : t('suggestions.page_unknown', 'Page unknown')}</Text>
        {pct !== null && <Badge tone={pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'danger'}>{t('obligations.confidence', 'Confidence {pct}%', { pct })}</Badge>}
        {verified === true && <Badge tone="success">{t('suggestions.quote_found', 'Quote found in the document')}</Badge>}
        {verified === false && <Badge tone="danger"><AlertTriangle className="size-g13" aria-hidden />{t('suggestions.quote_missing', 'Quote not found in the document: check it')}</Badge>}
        {verified === null && <Badge tone="neutral">{t('suggestions.quote_unchecked', 'Quote could not be checked')}</Badge>}
      </figcaption>
    </figure>
  );
};
