import React, { useId, useState } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Undo2,
  Redo2,
  Bold,
  Italic,
  Underline,
  Strikethrough,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Table,
  Superscript,
  Subscript,
  Eraser,
  Quote,
  Code2,
  Minus,
  Link2,
  Unlink,
  Highlighter,
  Rows3,
  Columns3,
  Trash2,
  IndentIncrease,
  IndentDecrease,
  Combine,
  SplitSquareHorizontal,
  PaintBucket,
  Sigma,
  Calculator,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { insertPricingTable, recalculatePricingTable } from '../../lib/tiptapPricingTable';

import { Button } from '@legalio/ui-components/button';
import { Toggle } from '@legalio/ui-components/toggle';
import { Separator } from '@legalio/ui-components/separator';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Popover, PopoverBody, PopoverContent, PopoverFooter, PopoverPositioner, PopoverTitle, PopoverTrigger } from '@legalio/ui-components/popover';
import { Input } from '@legalio/ui-components/input';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Text } from '@legalio/ui-components/text';
interface ContractEditorToolbarProps {
  editor: Editor | null;
}

/** Icon-only toolbar action: moduix Toggle for formatting state (aria-pressed), Button otherwise, each with a Tooltip. */
const ToolbarButton: React.FC<{
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  label: string;
  children: React.ReactNode;
}> = ({ onClick, active, disabled, label: title, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      {active === undefined
        ? <Button type="button" variant="ghost" size="icon-sm" onClick={onClick} disabled={disabled} aria-label={title}>{children}</Button>
        : <Toggle variant="ghost" size="icon-sm" pressed={active} onPressedChange={onClick} disabled={disabled} aria-label={title}>{children}</Toggle>}
    </TooltipTrigger>
    <TooltipBody>{title}</TooltipBody>
  </Tooltip>
);

const Divider = () => <Separator orientation="vertical" className="mx-g3 self-stretch" />;

const GRID_MAX = 8;

const CELL_COLORS: { key: string; label: string; value: string | null }[] = [
  { key: 'editor.color_none', label: 'Tanpa warna', value: null },
  { key: 'editor.color_gray', label: 'Abu-abu', value: '#f1f5f9' },
  { key: 'editor.color_red', label: 'Merah', value: '#fee2e2' },
  { key: 'editor.color_yellow', label: 'Kuning', value: '#fef9c3' },
  { key: 'editor.color_green', label: 'Hijau', value: '#dcfce7' },
  { key: 'editor.color_blue', label: 'Biru', value: '#dbeafe' },
  { key: 'editor.color_purple', label: 'Ungu', value: '#ede9fe' },
];

/** Hover-to-size table grid picker, matching the modern "Word/Notion-style" insert UX. */
const TableGridPicker: React.FC<{
  onPick: (rows: number, cols: number) => void;
}> = ({ onPick }) => {
  const [hovered, setHovered] = useState({ row: 0, col: 0 });

  return (
    <div className="grid gap-g8">
      <div className="grid w-fit grid-cols-8 gap-g2" onMouseLeave={() => setHovered({ row: 0, col: 0 })}>
        {Array.from({ length: GRID_MAX * GRID_MAX }).map((_, i) => {
          const row = Math.floor(i / GRID_MAX);
          const col = i % GRID_MAX;
          const isActive = row < hovered.row && col < hovered.col;
          return (
            <Toggle key={i} variant="outline" size="icon-sm" pressed={isActive}
              aria-label={`${row + 1} x ${col + 1}`}
              onMouseEnter={() => setHovered({ row: row + 1, col: col + 1 })}
              onFocus={() => setHovered({ row: row + 1, col: col + 1 })}
              onPressedChange={() => onPick(row + 1, col + 1)} className="size-g21 min-h-0 min-w-0" />
          );
        })}
      </div>
      <Text size="xs" tone="muted" className="inline-flex items-center justify-center gap-g3">
        <Table aria-hidden="true" className="size-g13" />{hovered.row || 1} x {hovered.col || 1}
      </Text>
    </div>
  );
};

export const ContractEditorToolbar: React.FC<ContractEditorToolbarProps> = ({
  editor,
}) => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [showAllTools, setShowAllTools] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputId = useId();

  if (!editor) return null;

  const insideTable = editor.isActive('table');

  const handleInsertPricingTable = () => {
    insertPricingTable(editor, {
      item: t('editor.pricing_table.item', 'Item'),
      qty: t('editor.pricing_table.qty', 'Qty'),
      unitPrice: t('editor.pricing_table.unit_price', 'Unit Price'),
      total: t('editor.pricing_table.total', 'Total'),
      grandTotal: t('editor.pricing_table.grand_total', 'Grand Total'),
    });
  };

  const handleRecalculatePricingTable = () => {
    const ok = recalculatePricingTable(editor);
    showAlert({
      title: ok
        ? t('editor.pricing_table.recalculated', 'Totals recalculated.')
        : t('editor.pricing_table.not_in_table', 'Place your cursor inside a pricing table first.'),
      variant: ok ? 'success' : 'warning',
    });
  };

  const setLink = (url: string) => {
    setLinkOpen(false);
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div role="toolbar" aria-label={t('editor.toolbar', 'Format dokumen')} className="z-10 shrink-0 border-b border-border bg-card px-g8 py-g3">
      <div className="flex items-center gap-g3 lg:hidden">
        <ToolbarButton label={t('editor.undo_ctrl_z')} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 /></ToolbarButton>
        <ToolbarButton label={t('editor.tebal_ctrl_b')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold /></ToolbarButton>
        <ToolbarButton label={t('editor.miring_ctrl_i')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic /></ToolbarButton>
        <Button variant="ghost" size="sm" type="button" aria-expanded={showAllTools} onClick={() => setShowAllTools(!showAllTools)} className="ms-auto">{t(showAllTools ? 'ui.fewer_tools' : 'ui.more_tools')}</Button>
      </div>
      <div className={`${showAllTools ? 'flex' : 'hidden'} lg:flex flex-wrap items-center gap-g2`}>
      {/* History */}
      <ToolbarButton label={t('editor.undo_ctrl_z', 'Undo (Ctrl+Z)')} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton label={t('editor.redo_ctrl_y', 'Redo (Ctrl+Y)')} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        <Redo2 />
      </ToolbarButton>

      <Divider />

      {/* Block type */}
      <ToolbarButton
        label={t('editor.heading_1_judul_utama', 'Heading 1 (Judul Utama)')}
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.heading_2_judul_pasal', 'Heading 2 (Judul Pasal)')}
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.heading_3', 'Heading 3')}
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.teks_normal_paragraf', 'Teks Normal Paragraf')}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        <Text as="span" size="xs" weight="bold">P</Text>
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.kutipan_blockquote', 'Kutipan (Blockquote)')}
        active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.blok_kode', 'Blok Kode')}
        active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 />
      </ToolbarButton>

      <Divider />

      {/* Text styling */}
      <ToolbarButton label={t('editor.tebal_ctrl_b', 'Tebal (Ctrl+B)')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold />
      </ToolbarButton>
      <ToolbarButton label={t('editor.miring_ctrl_i', 'Miring (Ctrl+I)')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic />
      </ToolbarButton>
      <ToolbarButton label={t('editor.garis_bawah_ctrl_u', 'Garis Bawah (Ctrl+U)')} active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline />
      </ToolbarButton>
      <ToolbarButton label={t('editor.coret_strikethrough', 'Coret (Strikethrough)')} active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough />
      </ToolbarButton>
      <ToolbarButton label={t('editor.sorot_teks_highlight', 'Sorot Teks (Highlight)')} active={editor.isActive('highlight')} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <Highlighter />
      </ToolbarButton>
      <Popover ids={{ trigger: 'editor-link-trigger' }} open={linkOpen} onOpenChange={(details) => {
        setLinkOpen(details.open);
        if (details.open) setLinkUrl((editor.getAttributes('link').href as string | undefined) || 'https://');
      }}>
        <Tooltip ids={{ trigger: 'editor-link-trigger' }}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Toggle variant="ghost" size="icon-sm" pressed={editor.isActive('link')} aria-label={t('editor.tautan_link', 'Tautan (Link)')}><Link2 /></Toggle>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipBody>{t('editor.tautan_link', 'Tautan (Link)')}</TooltipBody>
        </Tooltip>
        <PopoverPositioner>
          <PopoverContent>
            <form onSubmit={(event) => { event.preventDefault(); setLink(linkUrl.trim()); }} className="grid gap-g13">
              <PopoverTitle>{t('editor.tautan_link', 'Tautan (Link)')}</PopoverTitle>
              <Field>
                <FieldLabel htmlFor={linkInputId}>{t('editor.masukkan_url_tautan', 'Masukkan URL tautan:')}</FieldLabel>
                <Input id={linkInputId} type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} autoFocus />
              </Field>
              <PopoverFooter className="mt-0">
                <Button type="button" variant="outline" size="sm" onClick={() => setLinkOpen(false)}>{t('common.cancel', 'Batal')}</Button>
                <Button type="submit" size="sm">{t('admin.btn_apply', 'Terapkan')}</Button>
              </PopoverFooter>
            </form>
          </PopoverContent>
        </PopoverPositioner>
      </Popover>
      <ToolbarButton
        label={t('editor.hapus_tautan', 'Hapus Tautan')}
        disabled={!editor.isActive('link')}
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        <Unlink />
      </ToolbarButton>

      <Divider />

      {/* Alignment */}
      <ToolbarButton label={t('editor.rata_kiri', 'Rata Kiri')} active={editor.isActive({ textAlign: 'left' })} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        <AlignLeft />
      </ToolbarButton>
      <ToolbarButton label={t('editor.rata_tengah', 'Rata Tengah')} active={editor.isActive({ textAlign: 'center' })} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        <AlignCenter />
      </ToolbarButton>
      <ToolbarButton label={t('editor.rata_kanan', 'Rata Kanan')} active={editor.isActive({ textAlign: 'right' })} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        <AlignRight />
      </ToolbarButton>
      <ToolbarButton label={t('editor.rata_kanan_kiri_justify', 'Rata Kanan-Kiri (Justify)')} active={editor.isActive({ textAlign: 'justify' })} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
        <AlignJustify />
      </ToolbarButton>

      <Divider />

      {/* Lists */}
      <ToolbarButton label={t('editor.bullet_list', 'Bullet List')} active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List />
      </ToolbarButton>
      <ToolbarButton label={t('editor.numbered_list', 'Numbered List')} active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.kurangi_indentasi', 'Kurangi Indentasi')}
        disabled={!editor.can().liftListItem('listItem')}
        onClick={() => editor.chain().focus().liftListItem('listItem').run()}
      >
        <IndentDecrease />
      </ToolbarButton>
      <ToolbarButton
        label={t('editor.tambah_indentasi', 'Tambah Indentasi')}
        disabled={!editor.can().sinkListItem('listItem')}
        onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
      >
        <IndentIncrease />
      </ToolbarButton>

      <Divider />

      {/* Table */}
      <Popover ids={{ trigger: 'editor-table-trigger' }} open={showTableMenu} onOpenChange={(details) => setShowTableMenu(details.open)} positioning={{ placement: 'bottom-start' }}>
        <Tooltip ids={{ trigger: 'editor-table-trigger' }}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Toggle variant="ghost" size="icon-sm" pressed={showTableMenu} aria-label={t('partners.table_view', 'Tabel')}><Table /></Toggle>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipBody>{t('partners.table_view', 'Tabel')}</TooltipBody>
        </Tooltip>
        <PopoverPositioner>
          <PopoverContent className="w-fit min-w-0">
            <PopoverTitle className="sr-only">{t('partners.table_view', 'Tabel')}</PopoverTitle>
            <PopoverBody className="grid gap-g8">
            <TableGridPicker
              onPick={(rows, cols) => {
                editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
                setShowTableMenu(false);
              }}
            />

            {insideTable && (
              <div className="grid gap-g2 border-t border-border pt-g8">
                <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => { editor.chain().focus().addRowAfter().run(); setShowTableMenu(false); }}>
                  <Rows3 aria-hidden="true" />{t('editor.tambah_baris', 'Tambah Baris')}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => { editor.chain().focus().addColumnAfter().run(); setShowTableMenu(false); }}>
                  <Columns3 aria-hidden="true" />{t('editor.tambah_kolom', 'Tambah Kolom')}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => { editor.chain().focus().toggleHeaderRow().run(); setShowTableMenu(false); }}>
                  <Rows3 aria-hidden="true" />{t('editor.toggle_baris_header', 'Toggle Baris Header')}
                </Button>
                <Separator className="my-g3" />
                <Button type="button" variant="ghost" size="sm" className="justify-start" disabled={!editor.can().mergeCells()} onClick={() => { editor.chain().focus().mergeCells().run(); setShowTableMenu(false); }}>
                  <Combine aria-hidden="true" />{t('editor.gabung_sel_merge', 'Gabung Sel (Merge)')}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="justify-start" disabled={!editor.can().splitCell()} onClick={() => { editor.chain().focus().splitCell().run(); setShowTableMenu(false); }}>
                  <SplitSquareHorizontal aria-hidden="true" />{t('editor.pisah_sel_split', 'Pisah Sel (Split)')}
                </Button>
                <div className="grid gap-g5 px-g8 py-g5">
                  <Text size="xs" weight="semibold" tone="muted" className="inline-flex items-center gap-g3">
                    <PaintBucket aria-hidden="true" className="size-g13" /> {t('editor.warna_sel', 'Warna Sel')}
                  </Text>
                  <div className="flex items-center gap-g5">
                    {CELL_COLORS.map((c) => (
                      <Tooltip key={c.key}>
                        <TooltipTrigger asChild>
                          {/* Swatch fill is document content colour, not a UI token. */}
                          <Button type="button" variant="outline" size="icon-sm" aria-label={t(c.key, c.label)}
                            onClick={() => editor.chain().focus().setCellAttribute('backgroundColor', c.value).run()}
                            className="rounded-full" style={{ backgroundColor: c.value || undefined }} />
                        </TooltipTrigger>
                        <TooltipBody>{t(c.key, c.label)}</TooltipBody>
                      </Tooltip>
                    ))}
                  </div>
                </div>
                <Separator className="my-g3" />
                <Button type="button" variant="ghost" size="sm" className="justify-start text-destructive" onClick={() => { editor.chain().focus().deleteRow().run(); setShowTableMenu(false); }}>
                  <Trash2 aria-hidden="true" />{t('editor.hapus_baris', 'Hapus Baris')}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="justify-start text-destructive" onClick={() => { editor.chain().focus().deleteColumn().run(); setShowTableMenu(false); }}>
                  <Trash2 aria-hidden="true" />{t('editor.hapus_kolom', 'Hapus Kolom')}
                </Button>
                <Button type="button" variant="ghost" size="sm" className="justify-start text-destructive" onClick={() => { editor.chain().focus().deleteTable().run(); setShowTableMenu(false); }}>
                  <Trash2 aria-hidden="true" />{t('editor.hapus_seluruh_tabel', 'Hapus Seluruh Tabel')}
                </Button>
              </div>
            )}
            </PopoverBody>
          </PopoverContent>
        </PopoverPositioner>
      </Popover>

      <ToolbarButton label={t('editor.pricing_table.insert', 'Insert Pricing Table')} onClick={handleInsertPricingTable}>
        <Sigma />
      </ToolbarButton>
      <ToolbarButton label={t('editor.pricing_table.recalculate', 'Recalculate Totals')} onClick={handleRecalculatePricingTable} disabled={!insideTable}>
        <Calculator />
      </ToolbarButton>

      <Divider />

      {/* Misc */}
      <ToolbarButton label={t('editor.superscript_pangkat_atas', 'Superscript (Pangkat Atas)')} active={editor.isActive('superscript')} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
        <Superscript />
      </ToolbarButton>
      <ToolbarButton label={t('editor.subscript_pangkat_bawah', 'Subscript (Pangkat Bawah)')} active={editor.isActive('subscript')} onClick={() => editor.chain().focus().toggleSubscript().run()}>
        <Subscript />
      </ToolbarButton>
      <ToolbarButton label={t('editor.garis_horizontal', 'Garis Horizontal')} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus />
      </ToolbarButton>
      <ToolbarButton label={t('editor.hapus_format_teks', 'Hapus Format Teks')} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <Eraser />
      </ToolbarButton>
      </div>
    </div>
  );
};
