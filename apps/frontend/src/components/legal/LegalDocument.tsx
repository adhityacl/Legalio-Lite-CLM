import React, { useEffect } from 'react';
import { ArrowLeft, Mail, Printer } from 'lucide-react';
import { LANGUAGE_OPTIONS, useLanguage } from '../../context/LanguageContext';

import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Heading } from '@legalio/ui-components/heading';
import { SegmentGroup, SegmentGroupIndicator, SegmentGroupItems } from '@legalio/ui-components/segment-group';
import { Text } from '@legalio/ui-components/text';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Toc, TocContent, TocIndicator, TocItem, TocLink, TocList, TocNav, TocTitle } from '@legalio/ui-components/toc';
import { List, ListItem } from '@legalio/ui-components/list';
export type Clause = string | { text: string; items: string[] };
export interface LegalSection { title: string; clauses: Clause[] }
export interface LegalContent {
  navLabel: string;
  title: string;
  updated: string;
  intro: Clause[];
  sections: LegalSection[];
  contact: { title: string; text: string; email: string };
}
export type LegalCatalog = Record<'ID' | 'EN' | 'ZH', LegalContent>;

export interface LegalAccent {
  icon: React.ReactNode;
}

const LABELS = {
  EN: { toc: 'Table of Contents', back: 'Back to Login', print: 'Print / Save PDF', updated: 'Last updated' },
  ID: { toc: 'Daftar Isi', back: 'Kembali ke Login', print: 'Cetak / Simpan PDF', updated: 'Terakhir diperbarui' },
  ZH: { toc: '目录', back: '返回登录', print: '打印 / 保存 PDF', updated: '最后更新' },
} as const;

const alpha = (i: number) => String.fromCharCode(97 + i);

export const LegalDocument: React.FC<{
  catalog: LegalCatalog;
  accent: LegalAccent;
  idPrefix: string;
  onBack?: () => void;
}> = ({ catalog, accent, idPrefix, onBack }) => {
  const { language, setLanguage } = useLanguage();
  const doc = catalog[language] ?? catalog.EN;
  const L = LABELS[language] ?? LABELS.EN;

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const renderClause = (clause: Clause, label: string) => (
    <div key={label} className="flex gap-g13">
      <span className="shrink-0 w-g42 font-semibold tabular-nums text-muted-foreground">{label}</span>
      <div className="min-w-0 flex-1">
        <p>{typeof clause === 'string' ? clause : clause.text}</p>
        {typeof clause !== 'string' && (
          <List as="ol" marker="none" className="mt-g8 space-y-g5">
            {clause.items.map((item, i) => (
              <ListItem key={i} className="flex gap-g8">
                <span className="shrink-0 text-muted-foreground">({alpha(i)})</span>
                <span>{item}</span>
              </ListItem>
            ))}
          </List>
        )}
      </div>
    </div>
  );

  return (
    <main lang={language.toLowerCase()} className="legal-page h-screen overflow-y-auto scroll-smooth bg-background text-foreground transition-colors px-g13 py-g13 sm:px-g21 sm:py-g21 lg:px-g34">
      <div className="max-w-g987 mx-auto">
        <Card className="sticky top-g13 z-30 flex flex-wrap items-center justify-between gap-g13 backdrop-blur-md p-g13 sm:p-g13 print:hidden">
          <div className="flex items-center gap-g13">
            {onBack && (
              <Button variant="ghost"
                type="button"
                onClick={onBack}
              >
                <ArrowLeft aria-hidden="true" className="w-g16 h-g16" />
                <span>{L.back}</span>
              </Button>
            )}
            <div className="flex items-center gap-g8 text-xs font-medium text-muted-foreground">
              {accent.icon}
              <span>{doc.navLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-g8">
            <SegmentGroup aria-label="Language" value={language} onValueChange={details => details.value && setLanguage(details.value as typeof language)}>
              <SegmentGroupIndicator />
              <SegmentGroupItems items={LANGUAGE_OPTIONS.map(option => ({ value: option.code, label: <span lang={option.htmlLang}>{option.nativeName}</span> }))} />
            </SegmentGroup>
            <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-md"
              type="button"
              onClick={() => window.print()}
              aria-label={L.print}
            >
              <Printer aria-hidden="true" className="w-g16 h-g16" />
            </Button></TooltipTrigger><TooltipBody>{L.print}</TooltipBody></Tooltip>
          </div>
        </Card>

        <Card className="p-g21 sm:p-g34 lg:p-g55">
          <header className="pb-g21 mb-g34 border-b border-border">
            <Heading as="h1" size="2xl" weight="bold" className="sm:text-4xl text-balance">{doc.title}</Heading>
            <Text size="sm" tone="muted" className="mt-g8">{L.updated}: {doc.updated}</Text>
          </header>

          <Toc items={doc.sections.map((section, i) => ({ value: `${idPrefix}-${i + 1}`, depth: 2, label: `${i + 1}. ${section.title}` }))}
            className="grid gap-g34 lg:grid-cols-4 lg:items-start lg:gap-g55">
            <TocNav aria-label={L.toc} className="lg:sticky lg:top-g110 print:hidden">
              <TocTitle>{L.toc}</TocTitle>
              <TocList>
                <TocIndicator />
                {doc.sections.map((section, i) => {
                  const item = { value: `${idPrefix}-${i + 1}`, depth: 2, label: `${i + 1}. ${section.title}` };
                  return <TocItem key={item.value} item={item}><TocLink href={`#${item.value}`}>{item.label}</TocLink></TocItem>;
                })}
              </TocList>
            </TocNav>

            <TocContent className="min-w-0 lg:col-span-3">
            <article className="min-w-0 max-w-g610 text-foreground">
              <div className="space-y-g13 mb-g34">{doc.intro.map((c, i) => renderClause(c, `0.${i + 1}`))}</div>

              {doc.sections.map((s, i) => (
                <section key={i} className="scroll-mt-g21 mb-g34">
                  <Heading as="h2" id={`${idPrefix}-${i + 1}`} size="lg" weight="bold" className="mb-g13 scroll-mt-g21">
                    <span className="inline-block w-g42 text-accent-foreground">{i + 1}.</span>
                    {s.title}
                  </Heading>
                  <div className="space-y-g13">{s.clauses.map((c, j) => renderClause(c, `${i + 1}.${j + 1}`))}</div>
                </section>
              ))}

              <section className="mt-g55 p-g21 flex flex-col sm:flex-row sm:items-center justify-between gap-g13">
                <div>
                  <Heading as="h3" size="sm" weight="bold">{doc.contact.title}</Heading>
                  <Text size="sm" tone="muted" className="mt-g3">{doc.contact.text}</Text>
                </div>
                <Button asChild>
                  <a href={`mailto:${doc.contact.email}`}>
                    <Mail aria-hidden="true" className="w-g16 h-g16" />
                    <span>{doc.contact.email}</span>
                  </a>
                </Button>
              </section>
            </article>
            </TocContent>
          </Toc>

          <div className="mt-g34 pt-g21 border-t border-border flex flex-col sm:flex-row items-center justify-between gap-g13 text-xs text-muted-foreground print:hidden">
            <p>© 2026 Legalio. All rights reserved.</p>
            {onBack && (
              <Button variant="link" type="button" onClick={onBack}>
                ← {L.back}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </main>
  );
};
