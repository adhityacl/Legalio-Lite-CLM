import { assistantApi } from '../api/assistant';
import { isApiError } from '../api/client';
import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, User, Loader2, RotateCcw, Copy, Check } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useLanguage } from '../context/LanguageContext';

import { Button } from '@legalio/ui-components/button';
import { Table, TableColumnHeader, TableCell, TableScrollArea } from '@legalio/ui-components/table';
import { Input } from '@legalio/ui-components/input';
import { Card } from '@legalio/ui-components/card';
import { Avatar, AvatarFallback } from '@legalio/ui-components/avatar';
import { Text } from '@legalio/ui-components/text';
import { Typeset } from '@legalio/ui-components/typeset';
import { CloseButton } from '@legalio/ui-components/close-button';
import { Spinner } from '@legalio/ui-components/spinner';
import { Popover, PopoverBody, PopoverContent, PopoverFooter, PopoverHeader, PopoverPositioner, PopoverTitle, PopoverTrigger } from '@legalio/ui-components/popover';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
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
      let data: { reply?: string; error?: string } = {};
      let ok = true;
      try {
        data = await assistantApi.chat({ query: userMessage.text, history: historyPayload });
      } catch (failure) {
        ok = false;
        data = { error: isApiError(failure) && failure.status > 0 && !/^HTTP \d+$/.test(failure.message)
          ? failure.message
          : t('ai_chat.server_error_silakan_periksa_koneksi_atau', 'Server error ({status}): Silakan periksa koneksi atau kuota API Key.', { status: isApiError(failure) ? failure.status : 0 }) };
      }

      if (ok && data.reply) {
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

  const assistantAvatar = <Avatar size="sm"><AvatarFallback className="bg-transparent"><img src="/icon-192.png" alt="" aria-hidden="true" className="size-g21 object-contain" /></AvatarFallback></Avatar>;
  const closeLabel = t('ai_chat.tutup_ai_assistant', 'Tutup AI Assistant');
  const openLabel = t('ai_chat.buka_asisten_ai_silegal', 'Buka Asisten AI Legalio');

  return (
    <div className="fixed bottom-g13 right-g13 z-30 sm:bottom-g26 sm:right-g26">
      {/* Non-modal moduix Popover anchored to the launcher: the chat stays open while the page is used. */}
      <Popover ids={{ trigger: 'ai-chat-trigger' }} open={isOpen} onOpenChange={details => setIsOpen(details.open)} modal={false} closeOnInteractOutside={false} lazyMount unmountOnExit
        positioning={{ placement: 'top-end', gutter: 12 }}>
      <Tooltip ids={{ trigger: 'ai-chat-trigger' }}><TooltipTrigger asChild><PopoverTrigger asChild>
        <Button size="icon-lg" aria-label={isOpen ? closeLabel : openLabel}
          className="size-g55 rounded-full shadow-lg">
          <MessageSquare className="size-g21" aria-hidden="true" />
        </Button>
      </PopoverTrigger></TooltipTrigger><TooltipBody>{isOpen ? closeLabel : openLabel}</TooltipBody></Tooltip>
      <PopoverPositioner>
        <PopoverContent data-testid="ai-chat-panel"
          className="flex h-g610 max-h-(--available-height) w-g377 max-w-full max-w-none flex-col overflow-hidden p-0 ">
          <PopoverHeader className="flex items-center justify-between gap-g8 border-b border-border p-g13">
            <PopoverTitle className="flex items-center gap-g8"><img src="/icon-192.png" alt="" aria-hidden="true" className="size-g21 object-contain" />{t('ai_chat.silegal_ai', 'Legalio AI')}</PopoverTitle>
            <div className="flex items-center gap-g3">
              <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" onClick={handleResetSession}
                aria-label={t('ai_chat.reset_sesi_percakapan_hapus_konteks', 'Reset Sesi Percakapan (Hapus Konteks)')}>
                <RotateCcw aria-hidden="true" />
              </Button></TooltipTrigger><TooltipBody>{t('ai_chat.reset_sesi_percakapan_hapus_konteks', 'Reset Sesi Percakapan (Hapus Konteks)')}</TooltipBody></Tooltip>
              <CloseButton onClick={() => setIsOpen(false)} aria-label={t('ai_chat.tutup_chat', 'Tutup Chat')} />
            </div>
          </PopoverHeader>

          <PopoverBody className="flex flex-1 flex-col gap-g13 overflow-y-auto p-g13">
            {messages.map((msg) => (
              <div key={msg.id} className={`flex max-w-7/8 gap-g8 ${msg.role === 'user' ? 'flex-row-reverse self-end' : 'self-start'}`}>
                {msg.role === 'user'
                  ? <Avatar size="sm"><AvatarFallback className="bg-primary text-primary-foreground"><User size={14} /></AvatarFallback></Avatar>
                  : assistantAvatar}
                {msg.role === 'user' ? (
                  <Card size="sm" className="border-primary bg-primary p-g13 text-sm whitespace-pre-wrap text-primary-foreground">{msg.text}</Card>
                ) : (
                  <Card size="sm" className="gap-g8 p-g13">
                    <Typeset className="text-sm">
                      <ReactMarkdown
                        components={{
                          a: ({ node, ...props }) => <a target="_blank" rel="noopener noreferrer" {...props} />,
                          table: ({ node, ...props }) => (
                            <TableScrollArea className="rounded-md border border-border">
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
                    <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className="self-start max-sm:size-11 [&>svg]:size-g13" onClick={() => handleCopy(msg)}
                      aria-label={copiedId === msg.id ? t('ai_chat.copied', 'Tersalin') : t('ai_chat.copy', 'Salin jawaban')}>
                      {copiedId === msg.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      <span className="sr-only" aria-live="polite">{copiedId === msg.id ? t('ai_chat.copied', 'Tersalin') : t('ai_chat.copy', 'Salin')}</span>
                    </Button></TooltipTrigger><TooltipBody>{copiedId === msg.id ? t('ai_chat.copied', 'Tersalin') : t('ai_chat.copy', 'Salin jawaban')}</TooltipBody></Tooltip>
                  </Card>
                )}
              </div>
            ))}

            {/* Suggested prompts when starting fresh */}
            {isInitialOnly && (
              <div className="mt-g8 flex w-full flex-col gap-g8 border-t border-border pt-g13">
                <Text size="xs" weight="semibold" tone="muted">{t('ai_chat.saran_pertanyaan', 'Saran Pertanyaan:')}</Text>
                {SUGGESTED_PROMPTS.map(([key, fallback]) => t(key, fallback)).map((prompt) => (
                  <Button key={prompt} variant="outline" size="sm" onClick={() => handleSend(prompt)} className="h-auto justify-start py-g8 text-start whitespace-normal">
                    {prompt}
                  </Button>
                ))}
              </div>
            )}

            {isLoading && (
              <div className="flex max-w-5/6 gap-g8 self-start" role="status">
                {assistantAvatar}
                <Card size="sm" className="flex-row items-center gap-g8 p-g13 text-sm text-muted-foreground">
                  <Spinner size="sm" decorative />{t('ai_chat.menganalisis_data_konteks_sesi', 'Menganalisis data & konteks sesi...')}
                </Card>
              </div>
            )}
            <div ref={messagesEndRef} />
          </PopoverBody>

          <PopoverFooter className="mt-0 border-t border-border p-g13">
            <form onSubmit={(e) => handleSend(undefined, e)} className="flex w-full items-center gap-g8">
              <Input aria-label={t('ai_chat.tanya_seputar_data_atau_lanjutkan_konteks', 'Tanya seputar data atau lanjutkan konteks...')}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t('ai_chat.tanya_seputar_data_atau_lanjutkan_konteks', 'Tanya seputar data atau lanjutkan konteks...')}
                className="flex-1"
                disabled={isLoading}
              />
              <Tooltip><TooltipTrigger asChild><Button size="icon-md" type="submit" disabled={!input.trim() || isLoading}
                aria-label={t('ai_chat.kirim_pesan', 'Kirim Pesan')}>
                <Send aria-hidden="true" />
              </Button></TooltipTrigger><TooltipBody>{t('ai_chat.kirim_pesan', 'Kirim Pesan')}</TooltipBody></Tooltip>
            </form>
          </PopoverFooter>
        </PopoverContent>
      </PopoverPositioner>
      </Popover>
    </div>
  );
};
