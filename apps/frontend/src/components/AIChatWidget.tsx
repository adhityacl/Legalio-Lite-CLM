import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, User, Loader2, RotateCcw, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { AiIcon } from './icons/AiIcon';
import { useLanguage } from '../context/LanguageContext';

import { Button } from '@legalio/ui-components/button';
import { Table, TableColumnHeader, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Input } from '@legalio/ui-components/input';
import { Card } from '@legalio/ui-components/card';
interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
}

const INITIAL_MESSAGE: Message = {
  id: 'welcome',
  role: 'ai',
  text: 'Halo! Saya Asisten AI Legalio dengan **Session Context**. Anda bisa bertanya seputar partner, kontrak, atau IO, lalu melanjutkan dengan pertanyaan bertahap (follow-up) terkait topik sebelumnya.'
};

// [catalog key, default text]
const SUGGESTED_PROMPTS: Array<[string, string]> = [
  ['ai_chat.prompt_expiring', 'Berapa jumlah kontrak yang akan segera berakhir?'],
  ['ai_chat.prompt_tier1', 'Siapa saja partner Tier 1 yang aktif?'],
  ['ai_chat.prompt_spend', 'Ringkas total pengeluaran per mata uang.'],
  ['ai_chat.prompt_renewal', 'Apakah ada kontrak yang perlu perpanjangan/terminasi?'],
];

const STORAGE_KEY = 'silegal_ai_chat_session_v1';

export const AIChatWidget: React.FC<{ initiallyOpen?: boolean }> = ({ initiallyOpen = false }) => {
  const { t } = useLanguage();
  const [isOpen, setIsOpen] = useState(initiallyOpen);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const displayText = (msg: Message) =>
    msg.id === 'welcome'
      ? t('ai_chat.welcome', INITIAL_MESSAGE.text)
      : msg.id.startsWith('welcome-')
        ? t('ai_chat.sesi_percakapan_telah_direset_silakan_tanyakan', 'Sesi percakapan telah direset. Silakan tanyakan hal baru seputar partner, kontrak, atau IO!')
        : msg.text;

  const handleCopy = async (msg: Message) => {
    try {
      await navigator.clipboard.writeText(displayText(msg));
      setCopiedId(msg.id);
      window.setTimeout(() => setCopiedId((id) => (id === msg.id ? null : id)), 2000);
    } catch {
      // Clipboard blocked (insecure context or denied permission): nothing to copy to.
    }
  };
  const [messages, setMessages] = useState<Message[]>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return [INITIAL_MESSAGE];
  });
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Sync to sessionStorage
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // ignore
    }
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen]);

  const handleResetSession = () => {
    setMessages([
      {
        id: `welcome-${Date.now()}`,
        role: 'ai',
        text: t('ai_chat.sesi_percakapan_telah_direset_silakan_tanyakan', 'Sesi percakapan telah direset. Silakan tanyakan hal baru seputar partner, kontrak, atau IO!')
      }
    ]);
  };

  const handleSend = async (customText?: string, e?: React.FormEvent) => {
    if (e) e.preventDefault();

    const queryText = (customText || input).trim();
    if (!queryText || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: queryText
    };

    // Prepare history from existing messages (exclude initial greeting to keep context clean)
    const historyPayload = messages
      .filter((m) => m.id !== 'welcome' && !m.id.startsWith('welcome-'))
      .map((m) => ({
        role: m.role,
        text: m.text
      }));

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const tokenData = localStorage.getItem('silegal_google_token');
      const parsedAuth = tokenData ? JSON.parse(tokenData) : null;
      const token = parsedAuth?.access_token || '';

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          query: userMessage.text,
          history: historyPayload
        })
      });

      const rawText = await res.text();
      let data: any = {};
      try {
        data = JSON.parse(rawText);
      } catch {
        data = { error: res.ok ? rawText : t('ai_chat.server_error_silakan_periksa_koneksi_atau', 'Server error ({status}): Silakan periksa koneksi atau kuota API Key.', { status: res.status }) };
      }

      if (res.ok && data.reply) {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'ai',
            text: data.reply
          }
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          {
            id: (Date.now() + 1).toString(),
            role: 'ai',
            text: t('ai_chat.maaf_terjadi_kendala', 'Maaf, terjadi kendala: {value}', { value: data.error || 'Server AI tidak dapat memproses permintaan saat ini.' })
          }
        ]);
      }
    } catch (error) {
      console.error('AI Chat error:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: 'ai',
          text: t('ai_chat.maaf_gagal_terhubung_ke_server_ai', 'Maaf, gagal terhubung ke server AI. Pastikan koneksi internet stabil dan Gemini API Key telah terkonfigurasi.')
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const isInitialOnly = messages.length === 1 && (messages[0].id === 'welcome' || messages[0].id.startsWith('welcome-'));

  return (
    <div className="fixed bottom-3 right-3 sm:bottom-6 sm:right-6 z-30">
      {/* Chat Window */}
      {isOpen && (
        <Card
          className="absolute bottom-16 right-0 w-[calc(100vw-1.5rem)] sm:w-[410px] flex flex-col overflow-hidden animate-in transform origin-bottom-right"
          style={{ height: '520px', maxHeight: 'calc(100dvh - 6rem)' }}
        >
          {/* Header */}
          <div className="bg-primary px-4 py-3 text-white flex justify-between items-center shadow-md z-10 select-none">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 bg-card/20 rounded-lg flex items-center justify-center">
                <AiIcon size={18} className="text-white" />
              </div>
              <div>
                <h3 className="font-bold text-sm leading-tight text-white">
                  {t('ai_chat.silegal_ai', 'Legalio AI')}
                </h3>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm"
                type="button"
                onClick={handleResetSession}
                title={t('ai_chat.reset_sesi_percakapan_hapus_konteks', 'Reset Sesi Percakapan (Hapus Konteks)')}
              >
                <RotateCcw size={15} />
              </Button>
              <Button variant="ghost" size="icon-sm"
                type="button"
                onClick={() => setIsOpen(false)}
                title={t('ai_chat.tutup_chat', 'Tutup Chat')}
              >
                <X size={17} />
              </Button>
            </div>
          </div>

          {/* Message Area */}
          <div className="flex-1 overflow-y-auto p-4 bg-card flex flex-col gap-3">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2.5 max-w-[88%] ${
 msg.role === 'user' ? 'self-end flex-row-reverse' : 'self-start'
 }`}
              >
                <div
                  className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs ${
 msg.role === 'user'
 ? 'bg-primary text-white'
 : 'bg-card shadow-xs text-accent-foreground border border-border '
 }`}
                >
                  {msg.role === 'user' ? <User size={14} /> : <AiIcon size={14} />}
                </div>
                <Card
                  className={` p-3 text-xs leading-relaxed ${
 msg.role === 'user'
 ? 'bg-primary text-white'
 : 'text-foreground'
 }`}
                >
                  {msg.role === 'user' ? (
                    <div className="whitespace-pre-wrap font-medium">{msg.text}</div>
                  ) : (
                    <div className="wrap-break-word space-y-1">
                      <ReactMarkdown
                        components={{
                          ul: ({ node, ...props }) => <ul className="list-disc pl-4 my-1 space-y-0.5" {...props} />,
                          ol: ({ node, ...props }) => <ol className="list-decimal pl-4 my-1 space-y-0.5" {...props} />,
                          li: ({ node, ...props }) => <li className="my-0.5" {...props} />,
                          p: ({ node, ...props }) => <p className="mb-1.5 last:mb-0" {...props} />,
                          strong: ({ node, ...props }) => <strong className="font-bold text-foreground " {...props} />,
                          a: ({ node, ...props }) => (
                            <a
                              className="underline text-status-success hover:opacity-80"
                              target="_blank"
                              rel="noopener noreferrer"
                              {...props}
                            />
                          ),
                          h1: ({ node, ...props }) => <h1 className="text-sm font-bold mb-1 mt-2 text-foreground " {...props} />,
                          h2: ({ node, ...props }) => <h2 className="text-xs font-bold mb-1 mt-2 text-foreground " {...props} />,
                          h3: ({ node, ...props }) => <h3 className="text-xs font-bold mb-1 mt-1.5 text-foreground " {...props} />,
                          table: ({ node, ...props }) => (
                            <TableScrollArea>
                              <Table className="min-w-full" {...props} />
                            </TableScrollArea>
                          ),
                          th: ({ node, ...props }) => <TableColumnHeader className="text-left" {...props} />,
                          td: ({ node, ...props }) => <TableCell {...props} />
                        }}
                      >
                        {displayText(msg)}
                      </ReactMarkdown>
                      <Button variant="secondary" size="sm"
                        type="button"
                        onClick={() => handleCopy(msg)}
                        aria-label={copiedId === msg.id ? t('ai_chat.copied', 'Tersalin') : t('ai_chat.copy', 'Salin jawaban')}
                        title={copiedId === msg.id ? t('ai_chat.copied', 'Tersalin') : t('ai_chat.copy', 'Salin jawaban')}
                        className="mt-1.5"
                      >
                        {copiedId === msg.id ? <Check size={12} aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                        <span aria-live="polite">{copiedId === msg.id ? t('ai_chat.copied', 'Tersalin') : t('ai_chat.copy', 'Salin')}</span>
                      </Button>
                    </div>
                  )}
                </Card>
              </div>
            ))}

            {/* Suggested Prompts if starting fresh */}
            {isInitialOnly && (
              <div className="flex gap-2.5 self-start w-full mt-2 pt-3 border-t border-border">
                <div className="shrink-0 w-7 h-7 flex items-center justify-center text-status-success">
                  <AiIcon size={16} />
                </div>
                <div className="flex-1 min-w-0 flex flex-col gap-2">
                  <p className="text-xs font-bold text-muted-foreground flex items-center h-7">
                    {t('ai_chat.saran_pertanyaan', 'Saran Pertanyaan:')}
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {SUGGESTED_PROMPTS.map(([key, fallback]) => t(key, fallback)).map((prompt) => (
                      <Button variant="outline" size="sm"
                        key={prompt}
                        type="button"
                        onClick={() => handleSend(prompt)}
                        className="text-left"
                      >
                        {prompt}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {isLoading && (
              <div className="flex gap-2.5 self-start max-w-[85%]">
                <div className="shrink-0 w-7 h-7 rounded-full bg-card shadow-xs border border-border flex items-center justify-center text-accent-foreground">
                  <Loader2 size={14} className="animate-spin" />
                </div>
                <Card className="p-3 text-xs text-muted-foreground font-medium">
                  <span>{t('ai_chat.menganalisis_data_konteks_sesi', 'Menganalisis data & konteks sesi...')}</span>
                </Card>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 bg-card border-t border-border">
            <form onSubmit={(e) => handleSend(undefined, e)} className="flex items-center gap-2">
              <Input aria-label={t('ai_chat.tanya_seputar_data_atau_lanjutkan_konteks', 'Tanya seputar data atau lanjutkan konteks...')}
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t('ai_chat.tanya_seputar_data_atau_lanjutkan_konteks', 'Tanya seputar data atau lanjutkan konteks...')}
                className="flex-1"
                disabled={isLoading}
              />
              <Button size="icon-md"
                type="submit"
                disabled={!input.trim() || isLoading}
                title={t('ai_chat.kirim_pesan', 'Kirim Pesan')}
              >
                <Send size={15} />
              </Button>
            </form>
          </div>
        </Card>
      )}

      {/* Toggle Button */}
      <button
        aria-expanded={isOpen}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-13 h-13 rounded-full shadow-xl flex items-center justify-center transition-colors duration-150 cursor-pointer ${
 isOpen ? 'bg-primary/90' : 'bg-primary hover:bg-primary/90'
 }`}
        title={isOpen ? t('ai_chat.tutup_ai_assistant', 'Tutup AI Assistant') : t('ai_chat.buka_asisten_ai_silegal', 'Buka Asisten AI Legalio')}
      >
        <MessageSquare size={22} className="text-white" />
      </button>
    </div>
  );
};
