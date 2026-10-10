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
} from 'lucide-react';
import { Button } from '@legalio/ui-components/button';
import { Badge } from '@legalio/ui-components/badge';
import { Card } from '@legalio/ui-components/card';

import { DialogTitle } from '@legalio/ui-components/dialog';
interface ContractRedliningModalProps {
  isOpen: boolean;
  contract: Contract | null;
  onClose: () => void;
  onUpdateContract?: (updated: Contract) => void;
}

export const ContractRedliningModal: React.FC<ContractRedliningModalProps> = ({
  isOpen,
  contract,
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
          <Badge tone="success" className="gap-1.5">
            <ShieldCheck className="size-3.5" />
            {t('redline.risk_level_low', 'Risiko Rendah (Aman)')}
          </Badge>
        );
      case 'MEDIUM':
        return (
          <Badge tone="warning" className="gap-1.5">
            <AlertTriangle className="size-3.5" />
            {t('redline.risk_level_medium', 'Risiko Sedang (Perlu Penyesuaian)')}
          </Badge>
        );
      case 'HIGH':
        return (
          <Badge tone="warning" className="gap-1.5">
            <ShieldAlert className="size-3.5" />
            {t('redline.risk_level_high', 'Risiko Tinggi (Klausul Perlu Diwaspadai)')}
          </Badge>
        );
      case 'CRITICAL':
      default:
        return (
          <Badge tone="danger" className="gap-1.5">
            <AlertCircle className="size-3.5" />
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
Partner: ${contract.partner_nama}
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
    <ModalFrame onClose={onClose} className="w-full max-w-5xl max-h-[92dvh] flex flex-col overflow-hidden">

        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-gradient-to-r from-emerald-50/60 via-transparent to-transparent ">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-md bg-primary/10 text-accent-foreground flex items-center justify-center border border-primary/20 shadow-xs">
              <Scale className="size-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="flex items-center gap-2">
                  {t('redline.modal_title', 'Analisis Risiko & Kepatuhan Klausul Kontrak (Redlining)')}
                </DialogTitle>
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-status-success-soft text-status-success tracking-wide">
                  {t('redline.badge_audit', 'Audit Kepatuhan Klausul')}
                </span>
                {analysis && !loading && (
                  <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                    <CheckCircle2 className="size-3 text-status-success shrink-0" />
                    {analyzedAt
                      ? `${t('redline.saved_indicator', 'Hasil Tersimpan')} • ${new Date(analyzedAt).toLocaleDateString(getActiveFormattingLocale(), {
                          day: 'numeric',
                          month: 'short',
                          year: 'numeric',
                        })}`
                      : t('redline.saved_indicator', 'Hasil Tersimpan')}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                <span className="font-semibold text-foreground">{contract.nomor_kontrak}</span> • {contract.judul_kontrak} ({contract.partner_nama || t('redline.vendor', 'Vendor')})
              </p>
            </div>
          </div>
          <button aria-label={t('common.close', 'Tutup')}
            onClick={onClose}
            className="size-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-muted-foreground hover:bg-muted cursor-pointer transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 space-y-4">
              <div className="relative">
                <div className="size-16 rounded-full border-4 border-primary/20 border-t-accent-strong animate-spin" />
                <Scale className="size-6 text-accent-foreground absolute inset-0 m-auto" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-bold text-foreground text-sm">
                  {t('redline.analyzing', 'Menganalisis Kontrak & Memeriksa Risiko...')}
                </p>
                <p className="text-xs text-muted-foreground max-w-sm">
                  {t('redline.analyzing_desc', 'Sistem membedah klausul, menakar liabilitas hukum, dan menyiapkan rekomendasi redline...')}
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="p-6 rounded-2xl bg-status-danger-soft border border-status-danger-border text-center space-y-3 my-6">
              <AlertCircle className="size-8 text-status-danger mx-auto" />
              <div>
                <p className="font-bold text-status-danger text-sm">{t('redline.analisis_gagal', 'Analisis Gagal')}</p>
                <p className="text-xs text-status-danger mt-1">{error}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => executeAnalysis(true)}
              >
                <RotateCw className="size-3.5 mr-1.5" />
                {t('redline.coba_lagi', 'Coba Lagi')}
              </Button>
            </div>
          ) : analysis ? (
            <>
              {/* TOP SUMMARY CARDS */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Score Card */}
                <Card className="md:col-span-4 p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-muted-foreground">
                        {t('redline.risk_score', 'Skor Risiko Hukum')}
                      </span>
                      <Scale className="size-4 text-muted-foreground" />
                    </div>
                    <div className="flex items-baseline gap-2 mt-2">
                      <span className={`text-4xl font-extrabold tracking-tight ${getRiskScoreColor(analysis.overallRiskScore).split(' ')[0]}`}>
                        {analysis.overallRiskScore}
                      </span>
                      <span className="text-xs font-semibold text-muted-foreground">/ 100</span>
                    </div>
                  </div>
                  <div className="mt-4 pt-3 border-t border-border ">
                    {getRiskLevelBadge(analysis.riskLevel)}
                  </div>
                </Card>

                {/* Executive Summary Card */}
                <Card className="md:col-span-8 p-5 flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                      <Info className="size-3.5 text-accent-foreground" />
                      {t('redline.executive_summary', 'Ringkasan Eksekutif Legal')}
                    </span>
                    <p className="text-xs text-foreground mt-2 leading-relaxed line-clamp-4">
                      {analysis.executiveSummary}
                    </p>
                  </div>
                  {analysis.keyFindings && analysis.keyFindings.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {analysis.keyFindings.slice(0, 3).map((finding, idx) => (
                        <span
                          key={idx}
                          className="text-xs px-2.5 py-1 rounded-lg bg-card border border-border text-foreground font-medium"
                        >
                          ⚠️ {finding}
                        </span>
                      ))}
                    </div>
                  )}
                </Card>
              </div>

              {/* TABS HEADER */}
              <div className="flex items-center justify-between border-b border-border pb-2">
                <div className="flex items-center gap-2">
                  <Button size="sm"
                    onClick={() => setActiveTab('clauses')}
                    className={` ${
 activeTab === 'clauses'
 ? ''
 : ' '
 }`}
                  >
                    {t('redline.tab_clauses', 'Analisis Klausul & Redlining')} ({analysis.analyzedClauses?.length || 0})
                  </Button>
                  <Button size="sm"
                    onClick={() => setActiveTab('summary')}
                    className={` ${
 activeTab === 'summary'
 ? ''
 : ' '
 }`}
                  >
                    {t('redline.tab_summary', 'Kepatuhan Regulasi & Standar OJK')} ({analysis.complianceChecklist?.length || 0})
                  </Button>
                </div>

                {activeTab === 'clauses' && (
                  <div className="flex items-center gap-1">
                    <SlidersHorizontal className="size-3 text-muted-foreground mr-1" />
                    {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map((lvl) => (
                      <Button variant="secondary" size="sm"
                        key={lvl}
                        onClick={() => setSeverityFilter(lvl)}
                        className={` ${
 severityFilter === lvl
 ? ' '
 : ' '
 }`}
                      >
                        {lvl === 'ALL' ? t('redline.filter_all', 'Semua') : lvl}
                      </Button>
                    ))}
                  </div>
                )}
              </div>

              {/* TAB 1: CLAUSE ANALYSIS & REDLINING */}
              {activeTab === 'clauses' && (
                <div className="space-y-4">
                  {filteredClauses.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground text-xs">
                      {t('redline.tidak_ada_klausul_dengan_tingkat_risiko', 'Tidak ada klausul dengan tingkat risiko \'{severityFilter}\'.', { severityFilter })}
                    </div>
                  ) : (
                    filteredClauses.map((clause, idx) => (
                      <Card
                        key={idx}
                        className="overflow-hidden transition-colors"
                      >
                        <div className="p-4 space-y-3">
                          {/* Clause Header */}
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-foreground text-xs">
                                {idx + 1}. {clause.clauseTitle}
                              </span>
                              <span className="text-xs text-muted-foreground px-2 py-0.5 rounded-md bg-muted font-medium">
                                {clause.riskCategory}
                              </span>
                            </div>
                            <div>{getSeverityBadge(clause.severity)}</div>
                          </div>

                          {/* Original / Issue Box */}
                          <div className="p-3 rounded-xl bg-status-danger-soft/70 border border-status-danger-border/60 text-xs">
                            <p className="font-semibold text-status-danger text-xs mb-1 flex items-center gap-1">
                              <AlertTriangle className="size-3 text-status-danger" />
                              {t('redline.original_issue', 'Klausul Asal / Masalah Teridentifikasi')}
                            </p>
                            <p className="text-foreground leading-relaxed font-mono text-xs">
                              {clause.originalTextOrIssue}
                            </p>
                            <p className="text-status-danger text-xs mt-2 italic">
                              <strong>{t('redline.dampak', 'Dampak:')}</strong> {clause.identifiedRisk}
                            </p>
                          </div>

                          {/* Recommended Redline Box */}
                          <div className="p-3.5 rounded-xl bg-status-success-soft/70 border border-status-success-border/60 text-xs relative group">
                            <div className="flex items-center justify-between mb-1">
                              <p className="font-semibold text-status-success text-xs flex items-center gap-1">
                                <AiIcon className="size-3 text-status-success" />
                                {t('redline.recommended_redline', 'Rekomendasi Redlining (Revisi Lebih Adil & Patuh OJK)')}
                              </p>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCopyClause(clause.recommendedRedline, idx)}
                              >
                                {copiedClauseIdx === idx ? (
                                  <>
                                    <Check className="size-3 text-status-success" />
                                    {t('redline.copied', 'Tersalin!')}
                                  </>
                                ) : (
                                  <>
                                    <Copy className="size-3" />
                                    {t('redline.copy_clause', 'Salin Revisi')}
                                  </>
                                )}
                              </Button>
                            </div>
                            <p className="text-foreground leading-relaxed font-medium text-xs bg-card p-2.5 rounded-lg border border-status-success-border ">
                              "{clause.recommendedRedline}"
                            </p>
                            <p className="text-xs text-muted-foreground mt-2">
                              <strong>{t('redline.pertimbangan', 'Pertimbangan:')}</strong> {clause.legalRationale}
                            </p>
                          </div>
                        </div>
                      </Card>
                    ))
                  )}
                </div>
              )}

              {/* TAB 2: COMPLIANCE CHECKLIST (INCL. OJK REGULATIONS) */}
              {activeTab === 'summary' && (
                <div className="space-y-4">
                  <div className="p-3.5 rounded-2xl bg-status-info-soft/70 border border-status-info-border/80 flex items-start gap-2.5 text-xs text-status-info">
                    <Info className="size-4 text-status-info shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">{t('redline.standar_kepatuhan_ojk_regulasi_finansial_korpora', 'Standar Kepatuhan OJK & Regulasi Finansial / Korporasi')}</p>
                      <p className="text-xs text-status-info/80 mt-0.5">
                        {t('redline.daftar_periksa_ini_mencakup_pojk_kerja', 'Daftar periksa ini mencakup POJK Kerja Sama Pihak Ketiga, POJK Tata Kelola TI, Hak Audit Regulator OJK, serta kepatuhan UU PDP & KUHPerdata.')}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {analysis.complianceChecklist?.map((item, idx) => {
                      const isOjkItem = item.item.toUpperCase().includes('OJK') || item.item.toUpperCase().includes('POJK') || item.item.toUpperCase().includes('REGULATOR');
                      return (
                        <Card
                          key={idx}
                          className="p-4 flex items-start gap-3 relative overflow-hidden"
                        >
                          {item.status === 'COMPLIANT' ? (
                            <div className="size-7 rounded-xl bg-status-success-soft text-status-success flex items-center justify-center shrink-0 mt-0.5">
                              <CheckCircle2 className="size-4" />
                            </div>
                          ) : item.status === 'NEEDS_REVIEW' ? (
                            <div className="size-7 rounded-xl bg-status-warning-soft text-status-warning flex items-center justify-center shrink-0 mt-0.5">
                              <AlertTriangle className="size-4" />
                            </div>
                          ) : (
                            <div className="size-7 rounded-xl bg-status-danger-soft text-status-danger flex items-center justify-center shrink-0 mt-0.5">
                              <AlertCircle className="size-4" />
                            </div>
                          )}
                          <div className="space-y-1.5 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <p className="font-bold text-foreground text-xs">{item.item}</p>
                              {isOjkItem && (
                                <Badge tone="info" className="shrink-0">
                                  {t('redline.ojk_standard', 'OJK Standard')}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground leading-relaxed">{item.notes}</p>
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
                                <span className="inline-flex items-center text-xs font-bold text-status-danger">
                                  {t('redline.tidak_sesuai_berisiko_regulasi', '✗ Tidak Sesuai / Berisiko Regulasi')}
                                </span>
                              )}
                            </div>
                          </div>
                        </Card>
                      );
                    })}
                  </div>

                  {/* Key Findings List */}
                  <div className="p-4 rounded-2xl bg-status-warning-soft/50 border border-status-warning-border space-y-2">
                    <p className="font-bold text-status-warning text-xs flex items-center gap-1.5">
                      <AlertTriangle className="size-3.5 text-status-warning" />
                      {t('redline.key_findings', 'Temuan Risiko Utama')}
                    </p>
                    <ul className="space-y-1.5 text-xs text-foreground list-disc list-inside">
                      {analysis.keyFindings?.map((finding, idx) => (
                        <li key={idx} className="leading-relaxed">
                          {finding}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-border flex items-center justify-between bg-card/50 ">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => executeAnalysis(true)}
              disabled={loading}
            >
              <RotateCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{t('redline.reanalyze', 'Analisis Ulang')}</span>
            </Button>

            {analysis && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyFullReport}
              >
                {copiedFull ? <Check className="size-3.5 text-status-success" /> : <Copy className="size-3.5" />}
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
