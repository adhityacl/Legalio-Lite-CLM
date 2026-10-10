import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, User, Loader2, RotateCcw, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { AiIcon } from './icons/AiIcon';
import { useLanguage } from '../context/LanguageContext';

import { Button } from '@legalio/ui-components/button';
import { Table, TableColumnHeader, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Input } from '@legalio/ui-components/input';
import { Card, CardAction, CardBody, CardFooter, CardHeader, CardTitle } from '@legalio/ui-components/card';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
import { Text } from '@legalio/ui-components/text';
import { Typeset } from '@legalio/ui-components/typeset';
import { CloseButton } from '@legalio/ui-components/close-button';
import { Spinner } from '@legalio/ui-components/spinner';
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

  const assistantAvatar = <Avatar size="sm"><AvatarFallback className="bg-accent text-accent-foreground"><AiIcon size={14} /></AvatarFallback></Avatar>;
  const closeLabel = t('ai_chat.tutup_ai_assistant', 'Tutup AI Assistant');
  const openLabel = t('ai_chat.buka_asisten_ai_silegal', 'Buka Asisten AI Legalio');

  return (
    <div className="fixed bottom-3 right-3 z-30 sm:bottom-6 sm:right-6">
      {isOpen && (
        <Card role="dialog" aria-label={t('ai_chat.silegal_ai', 'Legalio AI')}
          className="absolute bottom-16 right-0 flex h-[520px] max-h-[calc(100dvh-6rem)] w-[calc(100vw-1.5rem)] flex-col overflow-hidden shadow-lg sm:w-[410px]">
          <CardHeader className="items-center border-b border-border pb-4">
            <CardTitle className="flex items-center gap-2"><AiIcon size={18} className="text-accent-foreground" />{t('ai_chat.silegal_ai', 'Legalio AI')}</CardTitle>
            <CardAction className="items-center">
              <Button variant="ghost" size="icon-sm" onClick={handleResetSession}
                aria-label={t('ai_chat.reset_sesi_percakapan_hapus_konteks', 'Reset Sesi Percakapan (Hapus Konteks)')}
                title={t('ai_chat.reset_sesi_percakapan_hapus_konteks', 'Reset Sesi Percakapan (Hapus Konteks)')}>
                <RotateCcw aria-hidden="true" />
              </Button>
              <CloseButton onClick={() => setIsOpen(false)} aria-label={t('ai_chat.tutup_chat', 'Tutup Chat')} />
            </CardAction>
          </CardHeader>

          <CardBody className="flex flex-1 flex-col gap-3 overflow-y-auto pt-4">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex max-w-[88%] gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse self-end' : 'self-start'}`}>
                {msg.role === 'user'
                  ? <Avatar size="sm"><AvatarFallback className="bg-primary text-primary-foreground"><User size={14} /></AvatarFallback></Avatar>
                  : assistantAvatar}
                {msg.role === 'user' ? (
                  <Card size="sm" className="border-primary bg-primary p-3 text-sm whitespace-pre-wrap text-primary-foreground">{msg.text}</Card>
                ) : (
                  <Card size="sm" className="gap-2 p-3">
                    <Typeset className="text-sm">
                      <ReactMarkdown
                        components={{
                          a: ({ node, ...props }) => <a target="_blank" rel="noopener noreferrer" {...props} />,
                          table: ({ node, ...props }) => (
                            <TableScrollArea>
                              <Table size="sm" {...props} />
                            </TableScrollArea>
                          ),
                          th: ({ node, ...props }) => <TableColumnHeader {...props} />,
                          td: ({ node, ...props }) => <TableCell {...props} />,
                        }}
                      >
                        {displayText(msg)}
                      </ReactMarkdown>
                    </Typeset>
                    <Button variant="ghost" size="sm" className="self-start" onClick={() => handleCopy(msg)}
                      aria-label={copiedId === msg.id ? t('ai_chat.copied', 'Tersalin') : t('ai_chat.copy', 'Salin jawaban')}
                      title={copiedId === msg.id ? t('ai_chat.copied', 'Tersalin') : t('ai_chat.copy', 'Salin jawaban')}>
                      {copiedId === msg.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      <span aria-live="polite">{copiedId === msg.id ? t('ai_chat.copied', 'Tersalin') : t('ai_chat.copy', 'Salin')}</span>
                    </Button>
                  </Card>
                )}
              </div>
            ))}

            {/* Suggested prompts when starting fresh */}
            {isInitialOnly && (
              <div className="mt-2 flex w-full flex-col gap-2 border-t border-border pt-3">
                <Text size="xs" weight="semibold" tone="muted">{t('ai_chat.saran_pertanyaan', 'Saran Pertanyaan:')}</Text>
                {SUGGESTED_PROMPTS.map(([key, fallback]) => t(key, fallback)).map((prompt) => (
                  <Button key={prompt} variant="outline" size="sm" onClick={() => handleSend(prompt)} className="h-auto justify-start py-2 text-start whitespace-normal">
                    {prompt}
                  </Button>
                ))}
              </div>
            )}

            {isLoading && (
              <div className="flex max-w-[85%] gap-2.5 self-start" role="status">
                {assistantAvatar}
                <Card size="sm" className="flex-row items-center gap-2 p-3 text-sm text-muted-foreground">
                  <Spinner size="sm" decorative />{t('ai_chat.menganalisis_data_konteks_sesi', 'Menganalisis data & konteks sesi...')}
                </Card>
              </div>
            )}
            <div ref={messagesEndRef} />
          </CardBody>

          <CardFooter className="border-t border-border pt-4">
            <form onSubmit={(e) => handleSend(undefined, e)} className="flex w-full items-center gap-2">
              <Input aria-label={t('ai_chat.tanya_seputar_data_atau_lanjutkan_konteks', 'Tanya seputar data atau lanjutkan konteks...')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t('ai_chat.tanya_seputar_data_atau_lanjutkan_konteks', 'Tanya seputar data atau lanjutkan konteks...')}
                className="flex-1"
                disabled={isLoading}
              />
              <Button size="icon-md" type="submit" disabled={!input.trim() || isLoading}
                aria-label={t('ai_chat.kirim_pesan', 'Kirim Pesan')} title={t('ai_chat.kirim_pesan', 'Kirim Pesan')}>
                <Send aria-hidden="true" />
              </Button>
            </form>
          </CardFooter>
        </Card>
      )}

      <Button size="icon-lg" aria-expanded={isOpen} onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? closeLabel : openLabel} title={isOpen ? closeLabel : openLabel}
        className="size-13 rounded-full shadow-lg">
        <MessageSquare className="size-5" aria-hidden="true" />
      </Button>
    </div>
  );
};
