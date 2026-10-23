import React, { useEffect, useState } from 'react';
import { Text } from '@legalio/ui-components/text';
import { Spinner } from '@legalio/ui-components/spinner';

/**
 * Page-level loading: small spinner and a 13px muted label, centred.
 * `delayed` hides it for the first 800 ms so a fast session check does not
 * flash a second loader before the in-shell one.
 */
export const LoadingState: React.FC<{ label: string; delayed?: boolean }> = ({ label, delayed = false }) => {
  const [visible, setVisible] = useState(!delayed);
  useEffect(() => {
    if (!delayed) return;
    const timer = setTimeout(() => setVisible(true), 800);
    return () => clearTimeout(timer);
  }, [delayed]);
  return (
    <div role="status" aria-label={label} className="flex min-h-g233 flex-1 items-center justify-center gap-g8 p-g21 text-sm text-muted-foreground">
      {visible && <><Spinner size="sm" decorative />{label}</>}
    </div>
  );
};

/** Full-page state shown instead of any privileged view (PRD §4.5.4, §6.2, §11.3). */
/** `standalone` screens have no app header, so they carry the page's only h1. */
export const StateScreen: React.FC<{ title: string; message?: string; children?: React.ReactNode; busy?: boolean; standalone?: boolean }> = ({ title, message, children, busy, standalone }) => {
  const Heading = standalone ? 'h1' : 'h2';
  // A transient load is a quiet status line, not a headline.
  if (busy) return <LoadingState label={title} />;
  return (
  <div className="relative flex min-h-[70dvh] items-center justify-center overflow-hidden px-g21 py-g42" aria-busy={busy || undefined}>
    {/* Soft decoration only: a pale sun and a few drifting bars, no box around the content. */}
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      <div className="absolute top-[7%] right-[12%] size-[min(26rem,60vw)] rounded-full bg-accent opacity-70" />
      <div className="absolute right-0 bottom-[22%] h-g21 w-[min(18rem,40vw)] rounded-l-full bg-accent opacity-50" />
      <div className="absolute right-[12%] bottom-[14%] h-g21 w-[min(13rem,30vw)] rounded-full bg-accent opacity-50" />
      <div className="absolute bottom-[26%] left-0 h-g26 w-[min(22rem,45vw)] rounded-r-full bg-accent opacity-50" />
      <div className="absolute bottom-[17%] left-[6%] h-g26 w-[min(28rem,55vw)] rounded-full bg-accent opacity-50" />
      <div className="absolute bottom-[10%] left-[14%] h-g21 w-[min(12rem,28vw)] rounded-full bg-accent opacity-50" />
    </div>
    <div className="relative z-10 flex max-w-g610 flex-col items-center gap-g21 text-center">
      <span className="text-base font-semibold text-foreground">Legalio.</span>
      <Heading className="text-3xl font-bold leading-tight tracking-tight text-foreground text-balance sm:text-5xl">{title}</Heading>
      {message && <Text size="md" tone="muted" align="center" className="max-w-g377 text-balance">{message}</Text>}
      {children && <div className="mt-g8 flex w-full flex-wrap justify-center gap-g13">{children}</div>}
    </div>
  </div>
  );
};
