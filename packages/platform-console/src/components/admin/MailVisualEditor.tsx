import { useEffect, useRef, useState } from 'react';
import { Bold, Italic, Underline, Link, List, ListOrdered, AlignLeft, AlignCenter, AlignRight, Undo2, Redo2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '@legalio/ui-components/button';

/** Keep email markup and inline styles intact; isolate authored HTML from the console. */
export function MailVisualEditor({ html, disabled, onChange, insertRef }: {
  html: string;
  disabled: boolean;
  onChange: (html: string) => void;
  insertRef: React.MutableRefObject<((text: string) => void) | null>;
}) {
  const { t, language } = useLanguage();
  const frame = useRef<HTMLIFrameElement>(null);
  const selection = useRef<Range | null>(null);
  const latest = useRef({ html, disabled, onChange });
  latest.current = { html, disabled, onChange };
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [block, setBlock] = useState('p');
  const remember = () => {
    const doc = frame.current?.contentDocument;
    const current = doc?.getSelection();
    if (current?.rangeCount && doc?.body?.contains(current.anchorNode)) selection.current = current.getRangeAt(0).cloneRange();
    if (doc) {
      setActive(Object.fromEntries(['bold', 'italic', 'underline', 'insertUnorderedList', 'insertOrderedList', 'justifyLeft', 'justifyCenter', 'justifyRight'].map(key => [key, doc.queryCommandState(key)])));
      const tag = String(doc.queryCommandValue('formatBlock')).toLowerCase();
      setBlock(['h1', 'h2', 'h3'].includes(tag) ? tag : 'p');
    }
  };
  const publish = () => {
    const doc = frame.current?.contentDocument;
    if (doc?.body) { latest.current.onChange(doc.body.innerHTML); remember(); }
  };
  const command = (name: string, value?: string) => {
    const doc = frame.current?.contentDocument;
    if (!doc?.body || latest.current.disabled) return;
    const current = doc.getSelection();
    frame.current?.contentWindow?.focus();
    if (selection.current && doc.body.contains(selection.current.startContainer)) {
      current?.removeAllRanges(); current?.addRange(selection.current);
    } else {
      const range = doc.createRange(); range.selectNodeContents(doc.body); range.collapse(false);
      current?.removeAllRanges(); current?.addRange(range);
    }
    doc.execCommand(name, false, value);
    publish();
  };
  useEffect(() => {
    insertRef.current = text => command('insertText', text);
    return () => { insertRef.current = null; };
  }, [insertRef]);
  useEffect(() => {
    const body = frame.current?.contentDocument?.body;
    if (body && body.innerHTML !== html) { body.innerHTML = html; selection.current = null; }
  }, [html]);
  useEffect(() => {
    const body = frame.current?.contentDocument?.body;
    if (body) body.contentEditable = String(!disabled);
  }, [disabled]);
  useEffect(() => {
    const doc = frame.current?.contentDocument;
    if (doc?.body) {
      doc.body.setAttribute('aria-label', t('mailer.visual_body'));
      doc.documentElement.lang = language === 'ZH' ? 'zh-CN' : language.toLowerCase();
    }
  }, [language, t]);
  function initialize() {
    const doc = frame.current?.contentDocument;
    if (!doc?.body) return;
    doc.body.innerHTML = latest.current.html;
    doc.body.contentEditable = String(!latest.current.disabled);
    doc.body.setAttribute('role', 'textbox');
    doc.body.setAttribute('aria-label', t('mailer.visual_body'));
    doc.documentElement.lang = language === 'ZH' ? 'zh-CN' : language.toLowerCase();
    doc.body.setAttribute('aria-multiline', 'true');
    doc.addEventListener('input', publish);
    doc.addEventListener('selectionchange', remember);
    doc.addEventListener('click', event => { if ((event.target as Element)?.closest('a')) event.preventDefault(); });
    selection.current = null;
  }
  const controls = [
    ['bold', 'Tebal', Bold], ['italic', 'Miring', Italic], ['underline', 'Garis bawah', Underline],
    ['insertUnorderedList', 'Daftar poin', List], ['insertOrderedList', 'Daftar bernomor', ListOrdered],
    ['justifyLeft', 'Rata kiri', AlignLeft], ['justifyCenter', 'Rata tengah', AlignCenter], ['justifyRight', 'Rata kanan', AlignRight],
    ['undo', 'Urungkan', Undo2], ['redo', 'Ulangi', Redo2],
  ] as const;
  return <div className="overflow-hidden rounded-xl border border-border">
    <div role="group" aria-label={t('mailer.toolbar.label')} className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/40 px-2 py-1">
      <select aria-label={t('mailer.toolbar.paragraph_format')} disabled={disabled} className="min-h-11 max-w-full rounded-md bg-transparent px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={block} onChange={e => command('formatBlock', e.target.value)}>
        <option value="p">{t('mailer.toolbar.paragraph', "Paragraf")}</option><option value="h1">{t('mailer.toolbar.heading1', "Judul 1")}</option><option value="h2">{t('mailer.toolbar.heading2', "Judul 2")}</option><option value="h3">{t('mailer.toolbar.heading3', "Judul 3")}</option>
      </select>
      {controls.map(([name, label, Icon]) => <Button key={name} type="button" variant="ghost" disabled={disabled} aria-label={t(`mailer.toolbar.${name}`, label)} aria-pressed={name === 'undo' || name === 'redo' ? undefined : Boolean(active[name])} title={t(`mailer.toolbar.${name}`, label)} onMouseDown={e => e.preventDefault()} onClick={() => command(name)} className={`min-h-11 min-w-11 px-2 ${active[name] ? 'bg-primary/10 text-primary' : ''}`}><Icon size={16} aria-hidden="true" /></Button>)}
      <Button type="button" variant="ghost" disabled={disabled} aria-label={t('mailer.toolbar.link')} aria-expanded={linkOpen} onMouseDown={e => e.preventDefault()} onClick={() => setLinkOpen(open => !open)} className="min-h-11 min-w-11 px-2"><Link size={16} aria-hidden="true" /></Button>
    </div>
    {linkOpen && <form className="flex flex-wrap items-end gap-2 border-b border-border p-3" onSubmit={event => { event.preventDefault(); command('createLink', url); setLinkOpen(false); setUrl(''); }}>
      <label className="min-w-0 flex-1 text-sm">{t('mailer.toolbar.url', "URL tautan")}<input autoFocus required value={url} onChange={e => { e.target.setCustomValidity(''); setUrl(e.target.value); }} onInvalid={e => e.currentTarget.setCustomValidity(t('mailer.error.link_url'))} pattern="(https?://[^\s]+|mailto:[^\s]+|\{\{\s*(url|inviteUrl)\s*\}\})" placeholder={t('mailer.toolbar.url_hint')} className="mt-1 w-full rounded-lg border border-border bg-background p-2" /></label>
      <Button type="submit" disabled={disabled}>{t('mailer.toolbar.apply', "Terapkan")}</Button><Button variant="outline" type="button" onClick={() => { command('unlink'); setLinkOpen(false); }}>{t('mailer.toolbar.unlink', "Hapus tautan")}</Button>
    </form>}
    <iframe ref={frame} title={t('mailer.visual_frame')} sandbox="allow-same-origin" referrerPolicy="no-referrer" onLoad={initialize} className="block min-h-[340px] w-full bg-white" srcDoc={'<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; base-uri \'none\'; form-action \'none\'"><style>html{color-scheme:light}body{box-sizing:border-box;min-height:320px;margin:0;padding:24px;font:14px/1.7 Arial,sans-serif;color:#1e293b;overflow-wrap:anywhere;outline:none}h1,h2,h3{line-height:1.3}a{color:#2850ff}table{max-width:100%}img{max-width:100%}body:focus-visible{box-shadow:inset 0 0 0 2px #2850ff}</style></head><body></body></html>'} />
  </div>;
}
