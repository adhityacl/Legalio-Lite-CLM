import { api, errorMessage } from '../api/client';
import React, { useState } from 'react';
import { Info, Send } from 'lucide-react';
import { RedlineAnalysisData } from '@legalio/types';
import { useLanguage } from '../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { Text } from '@legalio/ui-components/text';
import { Alert, AlertContent, AlertDescription, AlertIndicator } from '@legalio/ui-components/alert';
import { voidHandler } from '@legalio/shared/voidHandler';

interface ContractRedliningPanelProps {
  /** AI review endpoint and the current (possibly unsaved) form values it receives. */
  endpoint: string;
  body: Record<string, unknown>;
  title?: string;
  /** Extra content above the AI result, e.g. the service order's parent-contract checks. */
  children?: React.ReactNode;
  /** Wording overrides for non-contract reviews (e.g. partner due diligence). */
  labels?: { attention?: string; items?: string; original?: string; recommended?: string };
  /** Rendered below the key items once there is a result, e.g. the evaluation's rating suggestions. */
  renderExtra?: (analysis: RedlineAnalysisData) => React.ReactNode;
  canAnalyze: boolean;
  analysis: RedlineAnalysisData | null;
  onAnalysis: (analysis: RedlineAnalysisData, analyzedAt: string) => void;
}

const RISK_TONE: Record<string, string> = {
  LOW: 'text-status-success',
  MEDIUM: 'text-status-warning',
  HIGH: 'text-status-warning',
  CRITICAL: 'text-status-danger',
};

/** AI redlining shown beside the contract / service order form; the result is saved together with the record. */
export const ContractRedliningPanel: React.FC<ContractRedliningPanelProps> = ({ endpoint, body, title, children, labels, renderExtra, canAnalyze, analysis, onAnalysis }) => {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.post<{ analysis?: any; analyzed_at?: string }>(endpoint, body);
      if (!data?.analysis) throw new Error(t('redline.gagal_memproses_analisis_redlining', 'Gagal memproses analisis redlining.'));
      onAnalysis(data.analysis, data.analyzed_at || new Date().toISOString());
    } catch (err) {
      setError(errorMessage(err, t('redline.terjadi_kesalahan_saat_memproses_analisis', 'Terjadi kesalahan saat memproses analisis.')));
    } finally {
      setLoading(false);
    }
  };

  const clauses = analysis?.analyzedClauses || [];
  const toRedline = clauses.filter((c) => c.severity !== 'LOW').length;
  const tone = RISK_TONE[analysis?.riskLevel || ''] || 'text-foreground';

  return (
    <Card className="flex min-w-0 flex-col gap-g13 p-g21" aria-labelledby="contract-redlining-heading">
      <Heading as="h3" size="sm" weight="bold" id="contract-redlining-heading">{title ?? t('redline.panel_title', 'AI Contract Redlining')}</Heading>

      {children}

      {analysis && (
        <div className="flex items-center gap-g13 rounded-lg border border-border bg-muted/40 p-g13">
          <div className="flex w-g55 shrink-0 flex-col items-center">
            <span className={`text-3xl font-bold tabular-nums ${tone}`}>{analysis.overallRiskScore}</span>
            <Text as="span" size="xs" tone="muted">/ 100</Text>
          </div>
          <div className="min-w-0 space-y-g3">
            <Text as="span" size="xs" weight="bold" className={`font-mono uppercase ${tone}`}>{t(`redline.level_${analysis.riskLevel?.toLowerCase()}`, `${analysis.riskLevel} risk`)}</Text>
            <Text size="xs" tone="muted">{(labels?.attention ?? t('redline.clauses_to_redline', '{count} clauses require attention.')).replace('{count}', String(toRedline))}</Text>
          </div>
        </div>
      )}

      <Button type="button" onClick={voidHandler(analyze)} loading={loading} disabled={!canAnalyze || loading} className="w-full">
        <Send aria-hidden />
        {analysis ? t('redline.reanalyze', 'Analisis Ulang') : t('redline.analyze', 'Analyze')}
      </Button>
      {!canAnalyze && <Text size="xs" tone="muted">{t('redline.analyze_hint', 'Fill in the partner, number and title to analyze.')}</Text>}

      {error && <Alert status="error" role="alert"><AlertIndicator /><AlertContent><AlertDescription>{error}</AlertDescription></AlertContent></Alert>}

      {analysis && (
        <>
          <Card size="sm" className="space-y-g8 p-g13">
            <Text as="span" size="sm" weight="semibold" tone="muted" className="flex items-center gap-g5">
              <Info className="size-g13 text-accent-foreground" aria-hidden />
              {t('redline.executive_summary', 'Ringkasan Eksekutif Legal')}
            </Text>
            <Text size="sm" className="whitespace-pre-line leading-relaxed">{analysis.executiveSummary}</Text>
          </Card>

          {clauses.length > 0 && (
            <>
              <Text as="span" size="sm" weight="bold">{labels?.items ?? t('redline.key_redlines', 'Key redlines')}</Text>
              <ol className="flex flex-col gap-g8">
                {clauses.map((clause, idx) => (
                  <li key={idx} className="flex items-start gap-g8 rounded-md border border-border bg-muted/40 p-g13">
                    <span className="flex size-g26 shrink-0 items-center justify-center rounded-full bg-status-warning-soft font-mono text-xs font-bold text-status-warning">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <div className="min-w-0 space-y-g8">
                      <Text size="xs" weight="bold">{clause.clauseTitle}</Text>
                      <div className="space-y-g2">
                        <Text size="xs" weight="semibold" className="text-status-danger">{labels?.original ?? t('redline.original_clause', 'Original Clause')}</Text>
                        <Text size="xs" tone="muted" className="leading-relaxed">{clause.originalTextOrIssue}</Text>
                      </div>
                      <div className="space-y-g2">
                        <Text size="xs" weight="semibold" className="text-status-success">{labels?.recommended ?? t('redline.recommended_clause', 'Recommended Clause')}</Text>
                        <Text size="xs" className="leading-relaxed">{clause.recommendedRedline}</Text>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
          {renderExtra?.(analysis)}
        </>
      )}

      <Text size="xs" tone="muted">{t('redline.ai_disclaimer', 'Made by AI and can make mistakes.')}</Text>
    </Card>
  );
};
