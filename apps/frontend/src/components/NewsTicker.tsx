import React, { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { getAuthHeaders } from '../lib/apiFetch';

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
    <div
      className="relative bg-surface border border-hairline rounded-2xl mb-3 flex flex-wrap sm:flex-nowrap items-stretch overflow-hidden"
      role="region"
      aria-label={label}
    >
      <div className="w-full sm:w-auto shrink-0 flex items-center gap-1.5 px-4 py-3 bg-status-success-soft dark:bg-status-success-soft/40 text-status-success text-xs sm:text-sm font-bold whitespace-nowrap">
        <Megaphone className="w-4 h-4 shrink-0" />
        <span>{label}</span>
      </div>

      {/* Screen readers get the plain list; the moving copy is decorative. */}
      <ul className="sr-only">
        {items.map((item) => <li key={item}>{item}</li>)}
      </ul>

      <div className="news-ticker flex-1 min-w-0 overflow-hidden flex items-center py-3" aria-hidden="true">
        <div
          className="news-ticker-track flex w-max shrink-0 items-center"
          style={{ animationDuration: `${Math.max(30, Math.round(items.join('').length * 0.12))}s` }}
        >
          {[0, 1].map((copy) => (
            <div key={copy} className="flex shrink-0 items-center">
              {items.map((item) => (
                <span key={item} className="flex items-center whitespace-nowrap text-sm text-ink">
                  {item}
                  <span className="mx-6 size-1.5 shrink-0 rounded-full bg-status-success/70" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
