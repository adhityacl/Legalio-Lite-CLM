import React, { useState } from 'react';
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

interface ContractEditorToolbarProps {
  editor: Editor | null;
}

const ToolbarButton: React.FC<{
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}> = ({ onClick, active, disabled, title, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    aria-pressed={active}
    className={`min-w-10 min-h-10 lg:min-w-8 lg:min-h-8 inline-flex items-center justify-center p-1.5 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
      active
        ? 'bg-status-success-soft dark:bg-status-success-soft/60 text-status-success '
        : 'text-ink hover:bg-surface-2 dark:hover:bg-surface-2'
    }`}
  >
    {children}
  </button>
);

const Divider = () => (
  <div className="w-px self-stretch bg-surface-2 mx-1" />
);

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
    <div className="p-2.5">
      <div
        className="grid gap-[3px] w-fit mx-auto ds-grid"
        style={{ gridTemplateColumns: `repeat(${GRID_MAX}, 16px)`, gridAutoRows: '16px' }}
        onMouseLeave={() => setHovered({ row: 0, col: 0 })}
      >
        {Array.from({ length: GRID_MAX * GRID_MAX }).map((_, i) => {
          const row = Math.floor(i / GRID_MAX);
          const col = i % GRID_MAX;
          const isActive = row < hovered.row && col < hovered.col;
          return (
            <button
              key={i}
              type="button"
              onMouseEnter={() => setHovered({ row: row + 1, col: col + 1 })}
              onClick={() => onPick(row + 1, col + 1)}
              className={`w-full h-full rounded-sm border transition-colors ${
                isActive
                  ? 'bg-status-success border-status-success-border'
                  : 'bg-surface border-hairline '
              }`}
            />
          );
        })}
      </div>
      <div className="flex items-center justify-center gap-1 mt-2 text-xs font-semibold text-ink-soft bg-surface rounded-lg py-1">
        <Table className="w-3 h-3" />
        <span>{hovered.row || 1}</span>
        <span className="text-ink-soft">x</span>
        <span>{hovered.col || 1}</span>
      </div>
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

  const setLink = () => {
    const previousUrl = editor.getAttributes('link').href as string | undefined;
    const url = window.prompt(t('editor.masukkan_url_tautan', 'Masukkan URL tautan:'), previousUrl || 'https://');
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  };

  return (
    <div className="bg-surface border-b border-hairline px-2 py-1 shrink-0 z-10">
      <div className="flex items-center gap-1 lg:hidden">
        <ToolbarButton title={t('editor.undo_ctrl_z')} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}><Undo2 className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton title={t('editor.tebal_ctrl_b')} active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}><Bold className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton title={t('editor.miring_ctrl_i')} active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}><Italic className="w-4 h-4" /></ToolbarButton>
        <button type="button" aria-expanded={showAllTools} onClick={() => setShowAllTools(!showAllTools)} className="ml-auto min-h-10 px-2 text-sm font-semibold rounded-md">{t(showAllTools ? 'ui.fewer_tools' : 'ui.more_tools')}</button>
      </div>
      <div className={`${showAllTools ? 'flex' : 'hidden'} lg:flex flex-wrap items-center gap-0.5`}>
      {/* History */}
      <ToolbarButton title={t('editor.undo_ctrl_z', 'Undo (Ctrl+Z)')} onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
        <Undo2 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.redo_ctrl_y', 'Redo (Ctrl+Y)')} onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
        <Redo2 className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Block type */}
      <ToolbarButton
        title={t('editor.heading_1_judul_utama', 'Heading 1 (Judul Utama)')}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t('editor.heading_2_judul_pasal', 'Heading 2 (Judul Pasal)')}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t('editor.heading_3', 'Heading 3')}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t('editor.teks_normal_paragraf', 'Teks Normal Paragraf')}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        <span className="text-xs font-bold px-0.5">P</span>
      </ToolbarButton>
      <ToolbarButton
        title={t('editor.kutipan_blockquote', 'Kutipan (Blockquote)')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t('editor.blok_kode', 'Blok Kode')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      >
        <Code2 className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Text styling */}
      <ToolbarButton title={t('editor.tebal_ctrl_b', 'Tebal (Ctrl+B)')} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.miring_ctrl_i', 'Miring (Ctrl+I)')} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.garis_bawah_ctrl_u', 'Garis Bawah (Ctrl+U)')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <Underline className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.coret_strikethrough', 'Coret (Strikethrough)')} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.sorot_teks_highlight', 'Sorot Teks (Highlight)')} onClick={() => editor.chain().focus().toggleHighlight().run()}>
        <Highlighter className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.tautan_link', 'Tautan (Link)')} onClick={setLink}>
        <Link2 className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t('editor.hapus_tautan', 'Hapus Tautan')}
        disabled={!editor.isActive('link')}
        onClick={() => editor.chain().focus().unsetLink().run()}
      >
        <Unlink className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Alignment */}
      <ToolbarButton title={t('editor.rata_kiri', 'Rata Kiri')} onClick={() => editor.chain().focus().setTextAlign('left').run()}>
        <AlignLeft className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.rata_tengah', 'Rata Tengah')} onClick={() => editor.chain().focus().setTextAlign('center').run()}>
        <AlignCenter className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.rata_kanan', 'Rata Kanan')} onClick={() => editor.chain().focus().setTextAlign('right').run()}>
        <AlignRight className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.rata_kanan_kiri_justify', 'Rata Kanan-Kiri (Justify)')} onClick={() => editor.chain().focus().setTextAlign('justify').run()}>
        <AlignJustify className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Lists */}
      <ToolbarButton title={t('editor.bullet_list', 'Bullet List')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.numbered_list', 'Numbered List')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t('editor.kurangi_indentasi', 'Kurangi Indentasi')}
        disabled={!editor.can().liftListItem('listItem')}
        onClick={() => editor.chain().focus().liftListItem('listItem').run()}
      >
        <IndentDecrease className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title={t('editor.tambah_indentasi', 'Tambah Indentasi')}
        disabled={!editor.can().sinkListItem('listItem')}
        onClick={() => editor.chain().focus().sinkListItem('listItem').run()}
      >
        <IndentIncrease className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Table */}
      <div className="relative">
        <ToolbarButton
          title={t('partners.table_view', 'Tabel')}
          active={showTableMenu}
          onClick={() => setShowTableMenu((v) => !v)}
        >
          <Table className="w-3.5 h-3.5" />
        </ToolbarButton>
        {showTableMenu && (
          <div
            className="absolute top-full left-0 mt-1 w-fit bg-surface border border-hairline rounded-xl shadow-lg z-30"
            onMouseLeave={() => setShowTableMenu(false)}
          >
            <TableGridPicker
              onPick={(rows, cols) => {
                editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
                setShowTableMenu(false);
              }}
            />

            {insideTable && (
              <div className="p-1.5 space-y-0.5 border-t border-hairline">
                <button
                  type="button"
                  onClick={() => editor.chain().focus().addRowAfter().run()}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 text-ink-soft flex items-center gap-2 whitespace-nowrap"
                >
                  <Rows3 className="w-3.5 h-3.5" /> {t('editor.tambah_baris', 'Tambah Baris')}
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().addColumnAfter().run()}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 text-ink-soft flex items-center gap-2 whitespace-nowrap"
                >
                  <Columns3 className="w-3.5 h-3.5" /> {t('editor.tambah_kolom', 'Tambah Kolom')}
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().toggleHeaderRow().run()}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 text-ink-soft flex items-center gap-2 whitespace-nowrap"
                >
                  <Rows3 className="w-3.5 h-3.5" /> {t('editor.toggle_baris_header', 'Toggle Baris Header')}
                </button>
                <div className="h-px bg-surface-2 my-1" />
                <button
                  type="button"
                  disabled={!editor.can().mergeCells()}
                  onClick={() => editor.chain().focus().mergeCells().run()}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 text-ink-soft flex items-center gap-2 whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <Combine className="w-3.5 h-3.5" /> {t('editor.gabung_sel_merge', 'Gabung Sel (Merge)')}
                </button>
                <button
                  type="button"
                  disabled={!editor.can().splitCell()}
                  onClick={() => editor.chain().focus().splitCell().run()}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-md hover:bg-surface-2 dark:hover:bg-surface-2 text-ink-soft flex items-center gap-2 whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <SplitSquareHorizontal className="w-3.5 h-3.5" /> {t('editor.pisah_sel_split', 'Pisah Sel (Split)')}
                </button>
                <div className="px-2.5 py-1.5">
                  <div className="flex items-center gap-1 text-xs font-bold text-ink-soft mb-1.5">
                    <PaintBucket className="w-3 h-3" /> {t('editor.warna_sel', 'Warna Sel')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {CELL_COLORS.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        title={t(c.key, c.label)}
                        aria-label={t(c.key, c.label)}
                        onClick={() => editor.chain().focus().setCellAttribute('backgroundColor', c.value).run()}
                        className="w-5 h-5 rounded-full border border-hairline shrink-0"
                        style={{ backgroundColor: c.value || 'transparent' }}
                      />
                    ))}
                  </div>
                </div>
                <div className="h-px bg-surface-2 my-1" />
                <button
                  type="button"
                  onClick={() => editor.chain().focus().deleteRow().run()}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-md hover:bg-status-danger-soft dark:hover:bg-status-danger-soft/30 text-status-danger flex items-center gap-2 whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {t('editor.hapus_baris', 'Hapus Baris')}
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().deleteColumn().run()}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-medium rounded-md hover:bg-status-danger-soft dark:hover:bg-status-danger-soft/30 text-status-danger flex items-center gap-2 whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {t('editor.hapus_kolom', 'Hapus Kolom')}
                </button>
                <button
                  type="button"
                  onClick={() => editor.chain().focus().deleteTable().run()}
                  className="w-full text-left px-2.5 py-1.5 text-xs font-bold rounded-md hover:bg-status-danger-soft dark:hover:bg-status-danger-soft/30 text-status-danger flex items-center gap-2 whitespace-nowrap"
                >
                  <Trash2 className="w-3.5 h-3.5" /> {t('editor.hapus_seluruh_tabel', 'Hapus Seluruh Tabel')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <ToolbarButton title={t('editor.pricing_table.insert', 'Insert Pricing Table')} onClick={handleInsertPricingTable}>
        <Sigma className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.pricing_table.recalculate', 'Recalculate Totals')} onClick={handleRecalculatePricingTable} disabled={!insideTable}>
        <Calculator className="w-3.5 h-3.5" />
      </ToolbarButton>

      <Divider />

      {/* Misc */}
      <ToolbarButton title={t('editor.superscript_pangkat_atas', 'Superscript (Pangkat Atas)')} onClick={() => editor.chain().focus().toggleSuperscript().run()}>
        <Superscript className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.subscript_pangkat_bawah', 'Subscript (Pangkat Bawah)')} onClick={() => editor.chain().focus().toggleSubscript().run()}>
        <Subscript className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.garis_horizontal', 'Garis Horizontal')} onClick={() => editor.chain().focus().setHorizontalRule().run()}>
        <Minus className="w-3.5 h-3.5" />
      </ToolbarButton>
      <ToolbarButton title={t('editor.hapus_format_teks', 'Hapus Format Teks')} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <Eraser className="w-3.5 h-3.5" />
      </ToolbarButton>
      </div>
    </div>
  );
};
