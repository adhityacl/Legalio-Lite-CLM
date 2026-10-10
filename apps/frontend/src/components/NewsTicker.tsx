import React, { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { getAuthHeaders } from '../lib/apiFetch';
import { Card } from '@legalio/ui-components/card';
import { Badge } from '@legalio/ui-components/badge';
import { Marquee, MarqueeContent, MarqueeItem, MarqueeViewport } from '@legalio/ui-components/marquee';

type TickerStatus = 'loading' | 'ready' | 'empty' | 'error';


/**
 * Optional dashboard news ticker: 5 short regulatory headlines for the
 * tenant's industry and country, generated server-side by the configured AI
 * provider and cached for 7 days (GET /api/dashboard/news-ticker). Hidden
 * when the tenant's `newsTicker` module is off or no AI key is configured.
 */
export const NewsTicker: React.FC = () => {
  const { t } = useLanguage();
  const [status, setStatus] = useState<TickerStatus>('loading');
  const [items, setItems] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/dashboard/news-ticker', { headers: getAuthHeaders() });
        const text = await res.text();
        const data = text && !text.trim().startsWith('<') ? JSON.parse(text) : null;
        if (cancelled) return;
        const fetchedItems: string[] = Array.isArray(data?.items) ? data.items : [];
        if (!res.ok || fetchedItems.length === 0) {
          setStatus('empty');
          return;
        }
        setItems(fetchedItems);
        setStatus('ready');
      } catch (err) {
        console.error('Failed fetching news ticker:', err);
        if (!cancelled) setStatus('error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing meaningful to show and nothing to retry inline (a transient
  // Gemini error or a not-yet-configured API key) — quietly omit the
  // ticker rather than leaving an empty bar or an error banner on the
  // dashboard's very first card.
  if (status === 'loading' || status === 'empty' || status === 'error') {
    return null;
  }

  const label = t('dashboard.news_ticker_label', 'Info Regulasi Terkini');

  return (
    <Card role="region" aria-label={label} className="flex-row flex-wrap items-stretch overflow-hidden sm:flex-nowrap">
      <Badge tone="success" className="m-3 shrink-0 self-center"><Megaphone aria-hidden="true" />{label}</Badge>
      {/* Screen readers get the plain list; the moving copy is decorative. */}
      <ul className="sr-only">{items.map(item => <li key={item}>{item}</li>)}</ul>
      <Marquee aria-hidden="true" pauseOnInteraction autoFill spacing="2.5rem" speed={40} className="min-w-0 flex-1 self-center py-3">
        <MarqueeViewport>
          <MarqueeContent>
            {items.map(item => <MarqueeItem key={item} className="text-sm whitespace-nowrap text-foreground">{item}</MarqueeItem>)}
          </MarqueeContent>
        </MarqueeViewport>
      </Marquee>
    </Card>
  );
};
