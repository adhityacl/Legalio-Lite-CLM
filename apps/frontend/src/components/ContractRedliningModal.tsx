import { ModalFrame } from './ui/modal-frame';
import React, { useState, useEffect, useCallback } from 'react';
import { getActiveFormattingLocale } from '@legalio/shared/currencyUtils';
import { Contract, RedlineAnalysisData } from '@legalio/types';
import { useLanguage } from '../context/LanguageContext';
import { AiIcon } from './icons/AiIcon';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RotateCw,
  X,
  Scale,
  SlidersHorizontal,
  Info,
 RefreshCw } from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { Badge } from '@legalio/ui-components/badge';
import { Card } from '@legalio/ui-components/card';

import { DialogTitle } from '@legalio/ui-components/dialog';
import { SegmentGroup, SegmentGroupIndicator, SegmentGroupItems } from '@legalio/ui-components/segment-group';
import { CloseButton } from '@legalio/ui-components/close-button';
import { Alert, AlertActions, AlertContent, AlertDescription, AlertIndicator, AlertTitle } from '@legalio/ui-components/alert';
import { Spinner } from '@legalio/ui-components/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@legalio/ui-components/tabs';
import { Text } from '@legalio/ui-components/text';
import { List, ListItem } from '@legalio/ui-components/list';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
interface ContractRedliningModalProps {
  isOpen: boolean;
  contract: Contract | null;
  partnerName?: string;
  onClose: () => void;
  onUpdateContract?: (updated: Contract) => void;
}

export const ContractRedliningModal: React.FC<ContractRedliningModalProps> = ({
  isOpen,
  contract,
  partnerName,
  onClose,
  onUpdateContract,
}) => {
  const { t } = useLanguage();
  const [analysis, setAnalysis] = useState<RedlineAnalysisData | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'clauses' | 'summary'>('clauses');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [copiedClauseIdx, setCopiedClauseIdx] = useState<number | null>(null);
  const [copiedFull, setCopiedFull] = useState(false);
  const [customClauseText, setCustomClauseText] = useState('');

  // Eksekusi analisis redlining (hanya panggil Gemini jika belum ada data atau user klik "Analisis Ulang")
  const executeAnalysis = useCallback(
    async (force: boolean = false) => {
      if (!contract) return;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/contracts/${contract.contract_id}/redline-analysis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            force,
            customClauseText: customClauseText.trim() || undefined,
          }),
        });

        let data: any = {};
        try {
          data = await res.json();
        } catch {
          if (!res.ok) {
            throw new Error(t('redline.server_error_server_belum_siap_atau', 'Server error ({status}): Server belum siap atau route tidak ditemukan.', { status: res.status }));
          }
        }

        if (!res.ok) {
          throw new Error(data.error || t('redline.gagal_memproses_analisis_redlining', 'Gagal memproses analisis redlining.'));
        }

        if (data.analysis) {
          setAnalysis(data.analysis);
          const at = data.analyzed_at || data.analysis.analyzed_at || new Date().toISOString();
          setAnalyzedAt(at);
          const updatedContract: Contract = {
            ...contract,
            redline_analysis: data.analysis,
            redline_analyzed_at: at,
          };
          onUpdateContract?.(updatedContract);
        }
      } catch (err: any) {
        setError(err.message || t('redline.terjadi_kesalahan_saat_memproses_analisis', 'Terjadi kesalahan saat memproses analisis.'));
      } finally {
        setLoading(false);
      }
    },
    [contract, customClauseText, onUpdateContract]
  );

  // Periksa apakah sudah pernah dijalankan; jika sudah ada gunakan hasil tersimpan
  const checkAndLoadSavedAnalysis = useCallback(async () => {
    if (!contract) return;
    setError(null);

    // 1. Cek langsung pada contract object lokal
    if (contract.redline_analysis) {
      setAnalysis(contract.redline_analysis);
      setAnalyzedAt(contract.redline_analyzed_at || contract.redline_analysis.analyzed_at || null);
      setLoading(false);
      return;
    }

    // 2. Cek ke backend apakah sudah ada di database
    setLoading(true);
    try {
      const res = await fetch(`/api/contracts/${contract.contract_id}/redline-analysis`);
      if (res.ok) {
        const data = await res.json();
        if (data.hasAnalysis && data.analysis) {
          setAnalysis(data.analysis);
          const at = data.analyzed_at || data.analysis.analyzed_at || null;
          setAnalyzedAt(at);
          setLoading(false);
          const updatedContract: Contract = {
            ...contract,
            redline_analysis: data.analysis,
            redline_analyzed_at: at || undefined,
          };
          onUpdateContract?.(updatedContract);
          return;
        }
      }

      // 3. Jika belum pernah dianalisis sama sekali (pertama kali), jalankan analisis otomatis
      await executeAnalysis(false);
    } catch (err: any) {
      setError(err.message || t('redline.gagal_memuat_analisis', 'Gagal memuat analisis.'));
      setLoading(false);
    }
  }, [contract, executeAnalysis, onUpdateContract]);

  useEffect(() => {
    if (isOpen && contract) {
      checkAndLoadSavedAnalysis();
    } else {
      setAnalysis(null);
      setAnalyzedAt(null);
      setError(null);
    }
  }, [isOpen, contract?.contract_id]);

  if (!isOpen || !contract) return null;

  const getRiskScoreColor = (score: number) => {
    if (score <= 25) return 'text-status-success  border-status-success-border bg-status-success-soft ';
    if (score <= 55) return 'text-status-warning  border-status-warning-border bg-status-warning-soft ';
    if (score <= 75) return 'text-status-warning  border-status-warning-border bg-status-warning-soft ';
    return 'text-status-danger  border-status-danger-border bg-status-danger-soft ';
  };

  const getRiskLevelBadge = (level: string) => {
    switch (level) {
      case 'LOW':
        return (
          <Badge tone="success" className="gap-g5">
            <ShieldCheck className="size-g13" />
            {t('redline.risk_level_low', 'Risiko Rendah (Aman)')}
          </Badge>
        );
      case 'MEDIUM':
        return (
          <Badge tone="warning" className="gap-g5">
            <AlertTriangle className="size-g13" />
            {t('redline.risk_level_medium', 'Risiko Sedang (Perlu Penyesuaian)')}
          </Badge>
        );
      case 'HIGH':
        return (
          <Badge tone="warning" className="gap-g5">
            <ShieldAlert className="size-g13" />
            {t('redline.risk_level_high', 'Risiko Tinggi (Klausul Perlu Diwaspadai)')}
          </Badge>
        );
      case 'CRITICAL':
      default:
        return (
          <Badge tone="danger" className="gap-g5">
            <AlertCircle className="size-g13" />
            {t('redline.risk_level_critical', 'Risiko Kritis (Wajib Negosiasi Ulang)')}
          </Badge>
        );
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'LOW':
        return <Badge tone="success">{t('redline.low_risk', 'Low Risk')}</Badge>;
      case 'MEDIUM':
        return <Badge tone="warning">{t('redline.medium_risk', 'Medium Risk')}</Badge>;
      case 'HIGH':
        return <Badge tone="warning">{t('redline.high_risk', 'High Risk')}</Badge>;
      case 'CRITICAL':
      default:
        return <Badge tone="danger">{t('redline.filter_critical', 'Critical')}</Badge>;
    }
  };

  const handleCopyClause = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedClauseIdx(index);
    setTimeout(() => setCopiedClauseIdx(null), 2500);
  };

  const handleCopyFullReport = () => {
    if (!analysis) return;
    const reportText = `
=== LAPORAN AI CONTRACT RISK & REDLINING ===
Kontrak: ${contract.nomor_kontrak} - ${contract.judul_kontrak}
Partner: ${partnerName || '-'}
Skor Risiko: ${analysis.overallRiskScore}/100 (${analysis.riskLevel})

--- RINGKASAN EKSEKUTIF ---
${analysis.executiveSummary}

--- TEMUAN UTAMA ---
${analysis.keyFindings.map((f, i) => `${i + 1}. ${f}`).join('\n')}

--- DAFTAR REKOMENDASI REDLINING KLAUSUL ---
${analysis.analyzedClauses
  .map(
    (c, i) => `
[Klausul ${i + 1}] ${c.clauseTitle} (${c.severity})
• Isu/Asal: ${c.originalTextOrIssue}
• Potensi Risiko: ${c.identifiedRisk}
• Usulan Redline: ${c.recommendedRedline}
• Pertimbangan: ${c.legalRationale}
`
  )
  .join('\n')}
    `.trim();

    navigator.clipboard.writeText(reportText);
    setCopiedFull(true);
    setTimeout(() => setCopiedFull(false), 3000);
  };

  const filteredClauses = analysis?.analyzedClauses.filter((c) => {
    if (severityFilter === 'ALL') return true;
    return c.severity === severityFilter;
  }) || [];

  return (
    <ModalFrame size="xl" onClose={onClose} className="flex flex-col overflow-hidden">

        {/* Modal Header */}
        <div className="px-g21 py-g13 border-b border-border flex items-center justify-between bg-card">
          <div className="flex items-center gap-g13">
            <Avatar size="md" className="rounded-md bg-primary/10 text-accent-foreground border border-primary/20"><AvatarFallback className="bg-transparent text-inherit"><Scale className="size-g21" /></AvatarFallback></Avatar>
            <div>
              <div className="flex items-center gap-g8">
                <DialogTitle className="flex items-center gap-g8">
                  {t('redline.modal_title', 'Analisis Risiko & Kepatuhan Klausul Kontrak (Redlining)')}
                </DialogTitle>
                <Badge tone="success">{t('redline.badge_audit', 'Audit Kepatuhan Klausul')}</Badge>
                {analysis && !loading && (
                  <Badge tone="neutral" className="hidden sm:inline-flex"><CheckCircle2 className="size-g13 text-status-success shrink-0" />{analyzedAt
                      ? `${t('redline.saved_indicator', 'Hasil Tersimpan')} • ${new Date(analyzedAt).toLocaleDateString(getActiveFormattingLocale(), {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}`
                      : t('redline.saved_indicator', 'Hasil Tersimpan')}</Badge>
                )}
              </div>
              <Text size="xs" tone="muted" className="mt-g2">
                <span className="font-semibold text-foreground">{contract.nomor_kontrak}</span> • {contract.judul_kontrak} ({partnerName || t('redline.vendor', 'Vendor')})
              </Text>
            </div>
          </div>
          <CloseButton aria-label={t('common.close', 'Tutup')} onClick={onClose} />
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-g21 space-y-g21">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-g89 space-y-g13">
              <Spinner size="lg" decorative />
              <div className="text-center space-y-g3">
                <Text size="sm" weight="bold">
                  {t('redline.analyzing', 'Menganalisis Kontrak & Memeriksa Risiko...')}
                </Text>
                <Text size="xs" tone="muted" className="max-w-g377">
                  {t('redline.analyzing_desc', 'Sistem membedah klausul, menakar liabilitas hukum, dan menyiapkan rekomendasi redline...')}
                </Text>
              </div>
            </div>
          ) : error ? (
            <Alert status="error" role="alert" className="my-g21">
              <AlertIndicator />
              <AlertContent>
                <AlertTitle>{t('redline.analisis_gagal', 'Analisis Gagal')}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </AlertContent>
              <AlertActions>
              <Button
                variant="outline"
                size="sm"
                onClick={() => executeAnalysis(true)}
              >
                <RotateCw aria-hidden="true" />
                {t('redline.coba_lagi', 'Coba Lagi')}
              </Button>
              </AlertActions>
            </Alert>
          ) : analysis ? (
            <>
              {/* TOP SUMMARY CARDS */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-g13">
                {/* Score Card */}
                <Card className="md:col-span-4 p-g21 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <Text as="span" size="xs" weight="semibold" tone="muted">
                        {t('redline.risk_score', 'Skor Risiko Hukum')}
                      </Text>
                      <Scale className="size-g16 text-muted-foreground" />
                    </div>
                    <div className="flex items-baseline gap-g8 mt-g8">
                      <span className={`text-4xl font-extrabold tracking-tight ${getRiskScoreColor(analysis.overallRiskScore).split(' ')[0]}`}>
                        {analysis.overallRiskScore}
                      </span>
                      <Text as="span" size="xs" weight="semibold" tone="muted">/ 100</Text>
                    </div>
                  </div>
                  <div className="mt-g13 pt-g13 border-t border-border ">
                    {getRiskLevelBadge(analysis.riskLevel)}
                  </div>
                </Card>

                {/* Executive Summary Card */}
                <Card className="md:col-span-8 p-g21 flex flex-col justify-between">
                  <div>
                    <Text as="span" size="xs" weight="semibold" tone="muted" className="flex items-center gap-g5">
                      <Info className="size-g13 text-accent-foreground" />
                      {t('redline.executive_summary', 'Ringkasan Eksekutif Legal')}
                    </Text>
                    <Text size="xs" className="mt-g8 leading-relaxed line-clamp-4">
                      {analysis.executiveSummary}
                    </Text>
                  </div>
                  {analysis.keyFindings && analysis.keyFindings.length > 0 && (
                    <div className="mt-g13 flex flex-wrap gap-g5">
                      {analysis.keyFindings.slice(0, 3).map((finding, idx) => (
                        <Text as="span" size="xs" weight="medium" className="px-g8 py-g3 rounded-lg bg-card border border-border" key={idx}>
                          ⚠️ {finding}
                        </Text>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              {/* Tabs: clause analysis / compliance checklist */}
              <Tabs value={activeTab} onValueChange={details => setActiveTab(details.value as typeof activeTab)} className="gap-g13">
              <div className="flex flex-wrap items-center justify-between gap-g8">
                <TabsList aria-label={t('redline.view_label', 'Tampilan analisis')}>
                  <TabsTrigger value="clauses">{t('redline.tab_clauses', 'Analisis Klausul & Redlining')} ({analysis.analyzedClauses?.length || 0})</TabsTrigger>
                  <TabsTrigger value="summary">{t('redline.tab_summary', 'Kepatuhan Regulasi & Standar OJK')} ({analysis.complianceChecklist?.length || 0})</TabsTrigger>
                </TabsList>

                {activeTab === 'clauses' && (
                  <div className="flex items-center gap-g3">
                    <SlidersHorizontal className="size-g13 text-muted-foreground mr-g3" />
                    <SegmentGroup aria-label={t('redline.severity_filter', 'Filter tingkat risiko')} value={severityFilter} onValueChange={details => details.value && setSeverityFilter(details.value)}>
                      <SegmentGroupIndicator />
                      <SegmentGroupItems items={['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(lvl => ({ value: lvl, label: lvl === 'ALL' ? t('redline.filter_all', 'Semua') : lvl }))} />
                    </SegmentGroup>
                  </div>
                )}
              </div>

              {/* TAB 1: CLAUSE ANALYSIS & REDLINING */}
              <TabsContent value="clauses">
                <div className="space-y-g13">
                  {filteredClauses.length === 0 ? (
                    <div className="text-center py-g34 text-muted-foreground text-xs">
                      {t('redline.tidak_ada_klausul_dengan_tingkat_risiko', 'Tidak ada klausul dengan tingkat risiko \'{severityFilter}\'.', { severityFilter })}
                    </div>
                  ) : (
                    filteredClauses.map((clause, idx) => (
                      <Card
                        key={idx}
                        className="overflow-hidden transition-colors"
                      >
                        <div className="p-g13 space-y-g13">
                          {/* Clause Header */}
                          <div className="flex items-center justify-between gap-g13">
                            <div className="flex items-center gap-g8">
                              <Text as="span" size="xs" weight="bold">
                                {idx + 1}. {clause.clauseTitle}
                              </Text>
                              <Badge tone="neutral">{clause.riskCategory}</Badge>
                            </div>
                            <div>{getSeverityBadge(clause.severity)}</div>
                          </div>

                          {/* Original / Issue Box */}
                          <Alert status="error"><AlertIndicator /><AlertContent><AlertTitle>{t('redline.original_issue', 'Klausul Asal / Masalah Teridentifikasi')}</AlertTitle><AlertDescription>
                            <Text size="xs" className="font-mono leading-relaxed">
                              {clause.originalTextOrIssue}
                            </Text>
                            <Text size="xs" className="mt-g8 italic">
                              <strong>{t('redline.dampak', 'Dampak:')}</strong> {clause.identifiedRisk}
                            </Text></AlertDescription></AlertContent></Alert>

                          {/* Recommended Redline Box */}
                          <Alert status="success"><AlertIndicator><AiIcon /></AlertIndicator><AlertContent><AlertTitle>{t('redline.recommended_redline', 'Rekomendasi Redlining (Revisi Lebih Adil & Patuh OJK)')}</AlertTitle><AlertDescription><div className="mb-g3 flex justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCopyClause(clause.recommendedRedline, idx)}
                              >
                                {copiedClauseIdx === idx ? (
                                  <>
                                    <Check className="size-g13 text-status-success" />
                                    {t('redline.copied', 'Tersalin!')}
                                  </>
                                ) : (
                                  <>
                                    <Copy className="size-g13" />
                                    {t('redline.copy_clause', 'Salin Revisi')}
                                  </>
                                )}
                              </Button>
                            </div>
                            <Text size="xs" weight="medium" className="rounded-md border border-status-success-border bg-card p-g8 leading-relaxed">
                              "{clause.recommendedRedline}"
                            </Text>
                            <Text size="xs" tone="muted" className="mt-g8">
                              <strong>{t('redline.pertimbangan', 'Pertimbangan:')}</strong> {clause.legalRationale}
                            </Text></AlertDescription></AlertContent></Alert>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              </TabsContent>

              {/* TAB 2: COMPLIANCE CHECKLIST (INCL. OJK REGULATIONS) */}
              <TabsContent value="summary">
                <div className="space-y-g13">
                  <Alert status="info"><AlertIndicator /><AlertContent><AlertTitle>{t('redline.standar_kepatuhan_ojk_regulasi_finansial_korpora', 'Standar Kepatuhan OJK & Regulasi Finansial / Korporasi')}</AlertTitle><AlertDescription><div>
                      <p>
                        {t('redline.daftar_periksa_ini_mencakup_pojk_kerja', 'Daftar periksa ini mencakup POJK Kerja Sama Pihak Ketiga, POJK Tata Kelola TI, Hak Audit Regulator OJK, serta kepatuhan UU PDP & KUHPerdata.')}
                      </p>
                    </div></AlertDescription></AlertContent></Alert>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-g13">
                    {analysis.complianceChecklist?.map((item, idx) => {
                      const isOjkItem = item.item.toUpperCase().includes('OJK') || item.item.toUpperCase().includes('POJK') || item.item.toUpperCase().includes('REGULATOR');
                      return (
                        <Card
                          key={idx}
                          className="p-g13 flex items-start gap-g13 relative overflow-hidden"
                        >
                          {item.status === 'COMPLIANT' ? (
                            <Avatar size="sm" className="rounded-xl bg-status-success-soft text-status-success shrink-0 mt-g2"><AvatarFallback className="bg-transparent text-inherit"><CheckCircle2 className="size-g16" /></AvatarFallback></Avatar>
                          ) : item.status === 'NEEDS_REVIEW' ? (
                            <Avatar size="sm" className="rounded-xl bg-status-warning-soft text-status-warning shrink-0 mt-g2"><AvatarFallback className="bg-transparent text-inherit"><AlertTriangle className="size-g16" /></AvatarFallback></Avatar>
                          ) : (
                            <Avatar size="sm" className="rounded-xl bg-status-danger-soft text-status-danger shrink-0 mt-g2"><AvatarFallback className="bg-transparent text-inherit"><AlertCircle className="size-g16" /></AvatarFallback></Avatar>
                          )}
                          <div className="space-y-g5 flex-1">
                            <div className="flex items-center justify-between gap-g8">
                              <Text size="xs" weight="bold">{item.item}</Text>
                              {isOjkItem && (
                                <Badge tone="info" className="shrink-0">
                                  {t('redline.ojk_standard', 'OJK Standard')}
                                </Badge>
                              )}
                            </div>
                            <Text size="xs" tone="muted" className="leading-relaxed">{item.notes}</Text>
                            <div>
                              {item.status === 'COMPLIANT' ? (
                                <span className="inline-flex items-center text-xs font-bold text-status-success">
                                  {t('redline.memenuhi_standar_kepatuhan', '✓ Memenuhi Standar Kepatuhan')}
                                </span>
                              ) : item.status === 'NEEDS_REVIEW' ? (
                                <span className="inline-flex items-center text-xs font-bold text-status-warning">
                                  {t('redline.perlu_penyesuaian_klausul', '⚠️ Perlu Penyesuaian Klausul')}
                                </span>
                              ) : (
                                <Text as="span" size="xs" weight="bold" tone="destructive" className="inline-flex items-center">
                                  {t('redline.tidak_sesuai_berisiko_regulasi', '✗ Tidak Sesuai / Berisiko Regulasi')}
                                </Text>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>

                  {/* Key Findings List */}
                  <Alert status="warning"><AlertIndicator /><AlertContent><AlertTitle>{t('redline.key_findings', 'Temuan Risiko Utama')}</AlertTitle><AlertDescription>
                    <List marker="disc" className="space-y-g5">
                      {analysis.keyFindings?.map((finding, idx) => (
                        <ListItem key={idx} className="leading-relaxed">
                          {finding}
                        </ListItem>
                      ))}
                    </List></AlertDescription></AlertContent></Alert>
                </div>
              </TabsContent>
              </Tabs>
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="px-g21 py-g13 border-t border-border flex items-center justify-between bg-card/50 ">
          <div className="flex items-center gap-g8">
            <Button
              variant="outline"
              size="sm"
              onClick={() => executeAnalysis(true)}
              disabled={loading}
            >
              {loading ? <Spinner size="sm" decorative /> : <RefreshCw aria-hidden="true" />}
              <span>{t('redline.reanalyze', 'Analisis Ulang')}</span>
            </Button>

            {analysis && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyFullReport}
              >
                {copiedFull ? <Check className="size-g13 text-status-success" /> : <Copy className="size-g13" />}
                <span>{copiedFull ? t('redline.copied', 'Tersalin!') : t('redline.copy_full_report', 'Salin Seluruh Laporan')}</span>
              </Button>
            )}
          </div>

          <Button
            size="sm"
            onClick={onClose}
          >
            {t('redline.close', 'Tutup')}
          </Button>
        </div>

    </ModalFrame>
  );
};
