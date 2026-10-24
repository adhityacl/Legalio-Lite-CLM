import React, { useEffect, useId, useState } from 'react';
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
  PanelTop,
  PanelBottom,
  Hash,
  ImagePlus,
  WrapText,
  AlignHorizontalJustifyCenter,
  FileText,
  FilePlus2,
  SeparatorHorizontal,
  Ruler,
  ClipboardPaste,
  Scissors,
  Copy,
  ChevronDown,
  Check,
  Baseline,
  ArrowUpDown,
  Columns2,
  RectangleVertical,
  RectangleHorizontal,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useAlertToast } from '../../context/AlertToastContext';
import { insertPricingTable, recalculatePricingTable } from '../../lib/tiptapPricingTable';
import { LINE_SPACINGS, type ParagraphStyleName } from '../../lib/tiptapPageFormat';
import { FREE_WRAPS, IMAGE_WRAPS, ImageTooLargeError, SIDE_WRAPS, insertImageFiles, type ImageAlign, type ImageWrap } from '../../lib/tiptapImages';
import { MARGIN_PRESETS, PAPER_MM, mmToPx, pxToMm, type PageLayout, type PaperSize } from '@legalio/shared/pageLayout';

import { Button } from '@legalio/ui-components/button';
import { Toggle } from '@legalio/ui-components/toggle';
import { Separator } from '@legalio/ui-components/separator';
import { NativeSelect } from '@legalio/ui-components/native-select';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
import { Popover, PopoverBody, PopoverContent, PopoverFooter, PopoverPositioner, PopoverTitle, PopoverTrigger } from '@legalio/ui-components/popover';
import { Menu, MenuContent, MenuItem, MenuPositioner, MenuSeparator, MenuTrigger, MenuViewport } from '@legalio/ui-components/menu';
import { Input } from '@legalio/ui-components/input';
import { Field, FieldLabel } from '@legalio/ui-components/field';
import { Text } from '@legalio/ui-components/text';

type RibbonTab = 'home' | 'insert' | 'layout' | 'view' | 'picture';
export type HeaderFooterKind = 'header' | 'footer';

interface ContractEditorToolbarProps {
  editor: Editor | null;
  layout: PageLayout;
  onLayoutChange: (layout: PageLayout) => void;
  onOpenPageSetup: () => void;
  /** Starts editing the header or footer on the page itself. */
  onEditHeaderFooter: (kind: HeaderFooterKind) => void;
  /** `editor` is a header or footer being edited (the ribbon then formats it, and page-only actions are off). */
  editingHeaderFooter: boolean;
  showRuler: boolean;
  onToggleRuler: () => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
}

/** Fonts that exist in Word as well, so the downloaded document keeps the typeface on screen. */
export const DOCUMENT_FONTS = ['Arial', 'Calibri', 'Cambria', 'Courier New', 'Georgia', 'Tahoma', 'Times New Roman', 'Verdana'] as const;
export const DEFAULT_DOCUMENT_FONT = 'Arial';
const FONT_SIZES_PT = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const ZOOM_LEVELS = [50, 75, 90, 100, 110, 125, 150, 200];
const escapeHtml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const PAGE_FIELD = '<span data-page-number="page"></span>';
const TOTAL_FIELD = '<span data-page-number="total"></span>';
const CENTERED_PAGE_NUMBER = `<p style="text-align: center">${PAGE_FIELD}</p>`;
/** Word's "Blank (Three Columns)": left, centre and right text in a borderless one-row table. */
const THREE_COLUMNS = '<table><tbody><tr><td><p></p></td><td><p style="text-align: center"></p></td><td><p style="text-align: right"></p></td></tr></tbody></table>';

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

/** Large ribbon button: icon above its label, like Word's Paste or Header buttons. */
const bigButtonClass = 'h-auto min-h-g55 flex-col gap-g2 px-g5 py-g3 text-xs font-normal [&>svg:not([class*=size-])]:size-g26';

const BigButton: React.FC<{ icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }> = ({ icon, label, onClick, disabled }) => (
  <Button type="button" variant="ghost" className={bigButtonClass} onClick={onClick} disabled={disabled}>
    {icon}<span>{label}</span>
  </Button>
);

interface MenuOption {
  value: string;
  label: string;
  hint?: string;
  checked?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

/** Ribbon button with a dropdown of choices (Header, Margins, Size…). */
const RibbonMenu: React.FC<{
  icon: React.ReactNode;
  label: string;
  options: MenuOption[];
  onSelect: (value: string) => void;
  big?: boolean;
}> = ({ icon, label, options, onSelect, big = true }) => (
  <Menu positioning={{ placement: 'bottom-start', gutter: 4 }} onSelect={(details) => onSelect(details.value)}>
    <MenuTrigger asChild>
      <Button type="button" variant="ghost" size={big ? undefined : 'sm'} className={big ? bigButtonClass : undefined}>
        {icon}
        <span className="inline-flex items-center gap-g2">{label}<ChevronDown aria-hidden="true" className="size-g13" /></span>
      </Button>
    </MenuTrigger>
    <MenuPositioner>
      <MenuContent>
        <MenuViewport>
          {options.map((option) => (
            <React.Fragment key={option.value}>
              {option.separatorBefore && <MenuSeparator />}
              <MenuItem value={option.value} disabled={option.disabled}>
                <span className="inline-flex size-g16 shrink-0 items-center justify-center">{option.checked && <Check aria-hidden="true" className="size-g13" />}</span>
                <span className="grid">
                  <span>{option.label}</span>
                  {option.hint && <Text as="span" size="xs" tone="muted">{option.hint}</Text>}
                </span>
              </MenuItem>
            </React.Fragment>
          ))}
        </MenuViewport>
      </MenuContent>
    </MenuPositioner>
  </Menu>
);

/** A labelled cluster of controls separated by a thin rule, the way Word groups its ribbon. */
const RibbonGroup: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div role="group" aria-label={label} className="flex shrink-0 flex-col items-stretch gap-g2 border-e border-border px-g8 last:border-e-0">
    <div className="flex flex-1 items-center gap-g3">{children}</div>
  </div>
);

/** Two stacked rows of small controls inside one group. */
const Rows: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="grid content-center gap-g3">{children}</div>;
const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="flex items-center gap-g2">{children}</div>;

/** Alt text of the selected picture, applied on Enter or when the field loses focus. */
const AltTextField: React.FC<{ label: string; value: string; onApply: (alt: string) => void }> = ({ label, value, onApply }) => {
  const id = useId();
  return (
    <div className="flex items-center gap-g5">
      <label htmlFor={id} className="w-g42 text-xs text-muted-foreground">{label}</label>
      <Input key={value} id={id} size="sm" defaultValue={value} maxLength={250} className="w-g144"
        onBlur={(event) => { if (event.target.value !== value) onApply(event.target.value.trim()); }}
        onKeyDown={(event) => { if (event.key === 'Enter') onApply(event.currentTarget.value.trim()); }} />
    </div>
  );
};

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

const sameMargins = (a: PageLayout['margins'], b: PageLayout['margins']) =>
  a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;

const cm = (mm: number) => `${(mm / 10).toLocaleString(undefined, { maximumFractionDigits: 2 })} cm`;

/** A centimetre field (indent, picture width) that applies on Enter or when it loses focus. */
const CmField: React.FC<{ label: string; valueMm: number; onApply: (mm: number) => void }> = ({ label, valueMm, onApply }) => {
  const id = useId();
  const apply = (raw: string) => {
    const value = Number.parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(value) && value >= 0 && value <= 20) onApply(Math.round(value * 100) / 10);
  };
  return (
    <div className="flex items-center gap-g5">
      <label htmlFor={id} className="w-g42 text-xs text-muted-foreground">{label}</label>
      {/* Keyed by the value so selecting another paragraph or picture shows its value. */}
      <Input key={valueMm} id={id} size="sm" inputMode="decimal" defaultValue={(valueMm / 10).toString()} className="w-g68"
        onBlur={(event) => apply(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') apply(event.currentTarget.value); }} />
      <span className="text-xs text-muted-foreground">cm</span>
    </div>
  );
};

/** Word-style ribbon (File, Home, Insert, Layout, View) for the contract editor. */
export const ContractEditorToolbar: React.FC<ContractEditorToolbarProps> = ({
  editor,
  layout,
  onLayoutChange,
  onOpenPageSetup,
  onEditHeaderFooter,
  editingHeaderFooter,
  showRuler,
  onToggleRuler,
  zoom,
  onZoomChange,
}) => {
  const { t } = useLanguage();
  const showAlert = useAlertToast();
  const [tab, setTab] = useState<RibbonTab>('home');
  const [showTableMenu, setShowTableMenu] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const linkInputId = useId();
  const pictureInput = React.useRef<HTMLInputElement>(null);
  const tabsId = useId();

  // Word shows "Picture Format" while a picture is selected, and opens it when one is clicked.
  const pictureSelected = Boolean(editor?.isActive('image'));
  useEffect(() => {
    if (pictureSelected) setTab('picture');
    else setTab((current) => (current === 'picture' ? 'home' : current));
  }, [pictureSelected]);

  if (!editor) return null;

  const insideTable = editor.isActive('table');
  const insideList = editor.isActive('listItem');
  const chain = () => editor.chain().focus();

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
      chain().extendMarkRange('link').unsetLink().run();
      return;
    }
    chain().extendMarkRange('link').setLink({ href: url }).run();
  };

  // Clipboard: cut and copy go through the browser's own command so rich formatting is kept.
  const clipboardCommand = (command: 'cut' | 'copy') => {
    editor.commands.focus();
    if (!document.execCommand(command)) showAlert({ title: t('ribbon.clipboard_blocked', 'Use Ctrl+X / Ctrl+C: the browser blocked clipboard access.'), variant: 'warning' });
  };
  const paste = async () => {
    try {
      const items = await navigator.clipboard.read();
      const html = items.find((item) => item.types.includes('text/html'));
      if (html) {
        chain().insertContent(await (await html.getType('text/html')).text()).run();
        return;
      }
      chain().insertContent(await navigator.clipboard.readText()).run();
    } catch {
      showAlert({ title: t('ribbon.paste_blocked', 'Use Ctrl+V to paste: the browser blocked clipboard access.'), variant: 'warning' });
    }
  };

  const textStyle = editor.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string; color?: string };
  const blockAttributes = editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph') as {
    lineSpacing?: string | null; indentLeft?: number | null; indentRight?: number | null; paragraphStyle?: ParagraphStyleName | null;
  };
  const currentFont = DOCUMENT_FONTS.find((font) => (textStyle.fontFamily || '').replaceAll('"', '').startsWith(font)) ?? DEFAULT_DOCUMENT_FONT;
  const currentSize = Number.parseFloat(textStyle.fontSize || '') || 12;
  const blockStyle = editor.isActive('heading', { level: 1 }) ? 'h1'
    : editor.isActive('heading', { level: 2 }) ? 'h2'
    : editor.isActive('heading', { level: 3 }) ? 'h3'
    : editor.isActive('paragraph') ? blockAttributes.paragraphStyle ?? 'normal'
    : null;

  const applyBlockStyle = (value: string) => {
    if (value === 'h1' || value === 'h2' || value === 'h3') chain().setHeading({ level: Number(value[1]) as 1 | 2 | 3 }).run();
    else chain().setParagraphStyle(value === 'normal' ? null : (value as ParagraphStyleName)).run();
  };

  const indent = (direction: 1 | -1) => {
    if (insideList) {
      if (direction > 0) chain().sinkListItem('listItem').run();
      else chain().liftListItem('listItem').run();
    } else chain().shiftParagraphIndent(direction).run();
  };

  const setHeaderFooter = (kind: HeaderFooterKind, html: string) => onLayoutChange({ ...layout, [kind]: html });
  const pageXOfY = `<p style="text-align: right">${escapeHtml(t('page.page_x_of_y_text', 'Halaman {page} dari {total}')).replace('{page}', PAGE_FIELD).replace('{total}', TOTAL_FIELD)}</p>`;
  const pageOnly = insideTable || editingHeaderFooter;

  const headerFooterMenu = (kind: 'header' | 'footer') => {
    const isHeader = kind === 'header';
    const options: MenuOption[] = [
      { value: 'blank', label: t('ribbon.hf_blank', 'Blank') },
      { value: 'three', label: t('ribbon.hf_three_columns', 'Blank (Three Columns)') },
      ...(isHeader ? [] : [{ value: 'number', label: t('ribbon.page_number', 'Page Number') }]),
      { value: 'edit', label: isHeader ? t('ribbon.edit_header', 'Edit Header') : t('ribbon.edit_footer', 'Edit Footer'), separatorBefore: true },
      { value: 'remove', label: isHeader ? t('ribbon.remove_header', 'Remove Header') : t('ribbon.remove_footer', 'Remove Footer') },
    ];
    return (
      <RibbonMenu
        icon={isHeader ? <PanelTop aria-hidden="true" /> : <PanelBottom aria-hidden="true" />}
        label={isHeader ? t('ribbon.header', 'Header') : t('ribbon.footer', 'Footer')}
        options={options}
        onSelect={(value) => {
          if (value === 'remove') setHeaderFooter(kind, '');
          else if (value === 'number') setHeaderFooter(kind, CENTERED_PAGE_NUMBER);
          else {
            if (value === 'blank') setHeaderFooter(kind, '');
            if (value === 'three') setHeaderFooter(kind, THREE_COLUMNS);
            onEditHeaderFooter(kind);
          }
        }}
      />
    );
  };

  const homeTab = (
    <>
      <RibbonGroup label={t('ribbon.group_clipboard', 'Clipboard')}>
        <BigButton icon={<ClipboardPaste aria-hidden="true" />} label={t('ribbon.paste', 'Paste')} onClick={() => void paste()} />
        <Rows>
          <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => clipboardCommand('cut')} disabled={editor.state.selection.empty}><Scissors aria-hidden="true" />{t('ribbon.cut', 'Cut')}</Button>
          <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => clipboardCommand('copy')} disabled={editor.state.selection.empty}><Copy aria-hidden="true" />{t('ribbon.copy', 'Copy')}</Button>
        </Rows>
        <Rows>
          <ToolbarButton label={t('editor.undo_ctrl_z', 'Undo (Ctrl+Z)')} onClick={() => chain().undo().run()} disabled={!editor.can().undo()}><Undo2 /></ToolbarButton>
          <ToolbarButton label={t('editor.redo_ctrl_y', 'Redo (Ctrl+Y)')} onClick={() => chain().redo().run()} disabled={!editor.can().redo()}><Redo2 /></ToolbarButton>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_font', 'Font')}>
        <Rows>
          <Row>
            <NativeSelect aria-label={t('ribbon.font_family', 'Font')} value={currentFont} onChange={(event) => chain().setFontFamily(event.target.value).run()} controlProps={{ className: 'w-g144' }}>
              {DOCUMENT_FONTS.map((font) => <option key={font} value={font}>{font}</option>)}
            </NativeSelect>
            <NativeSelect aria-label={t('ribbon.font_size', 'Font size')} value={String(FONT_SIZES_PT.includes(currentSize) ? currentSize : 12)} onChange={(event) => chain().setFontSize(`${event.target.value}pt`).run()} controlProps={{ className: 'w-g68' }}>
              {FONT_SIZES_PT.map((size) => <option key={size} value={size}>{size}</option>)}
            </NativeSelect>
            <ToolbarButton label={t('editor.hapus_format_teks', 'Clear formatting')} onClick={() => chain().unsetAllMarks().run()}><Eraser /></ToolbarButton>
          </Row>
          <Row>
            <ToolbarButton label={t('editor.tebal_ctrl_b', 'Bold (Ctrl+B)')} active={editor.isActive('bold')} onClick={() => chain().toggleBold().run()}><Bold /></ToolbarButton>
            <ToolbarButton label={t('editor.miring_ctrl_i', 'Italic (Ctrl+I)')} active={editor.isActive('italic')} onClick={() => chain().toggleItalic().run()}><Italic /></ToolbarButton>
            <ToolbarButton label={t('editor.garis_bawah_ctrl_u', 'Underline (Ctrl+U)')} active={editor.isActive('underline')} onClick={() => chain().toggleUnderline().run()}><Underline /></ToolbarButton>
            <ToolbarButton label={t('editor.coret_strikethrough', 'Strikethrough')} active={editor.isActive('strike')} onClick={() => chain().toggleStrike().run()}><Strikethrough /></ToolbarButton>
            <ToolbarButton label={t('editor.subscript_pangkat_bawah', 'Subscript')} active={editor.isActive('subscript')} onClick={() => chain().toggleSubscript().run()}><Subscript /></ToolbarButton>
            <ToolbarButton label={t('editor.superscript_pangkat_atas', 'Superscript')} active={editor.isActive('superscript')} onClick={() => chain().toggleSuperscript().run()}><Superscript /></ToolbarButton>
            <ToolbarButton label={t('editor.sorot_teks_highlight', 'Highlight')} active={editor.isActive('highlight')} onClick={() => chain().toggleHighlight().run()}><Highlighter /></ToolbarButton>
            <Tooltip>
              <TooltipTrigger asChild>
                <label className="relative inline-flex size-control-sm cursor-pointer items-center justify-center rounded-md hover:bg-muted">
                  <Baseline aria-hidden="true" className="size-g16" />
                  <input
                    type="color"
                    aria-label={t('ribbon.text_color', 'Text colour')}
                    value={textStyle.color && /^#[0-9a-f]{6}$/i.test(textStyle.color) ? textStyle.color : '#000000'}
                    onChange={(event) => chain().setColor(event.target.value).run()}
                    className="absolute inset-0 cursor-pointer opacity-0"
                  />
                </label>
              </TooltipTrigger>
              <TooltipBody>{t('ribbon.text_color', 'Text colour')}</TooltipBody>
            </Tooltip>
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_paragraph', 'Paragraph')}>
        <Rows>
          <Row>
            <ToolbarButton label={t('editor.bullet_list', 'Bullet list')} active={editor.isActive('bulletList')} onClick={() => chain().toggleBulletList().run()}><List /></ToolbarButton>
            <ToolbarButton label={t('editor.numbered_list', 'Numbered list')} active={editor.isActive('orderedList')} onClick={() => chain().toggleOrderedList().run()}><ListOrdered /></ToolbarButton>
            <ToolbarButton label={t('editor.kurangi_indentasi', 'Decrease indent')} onClick={() => indent(-1)}><IndentDecrease /></ToolbarButton>
            <ToolbarButton label={t('editor.tambah_indentasi', 'Increase indent')} onClick={() => indent(1)}><IndentIncrease /></ToolbarButton>
          </Row>
          <Row>
            <ToolbarButton label={t('editor.rata_kiri', 'Align left')} active={editor.isActive({ textAlign: 'left' })} onClick={() => chain().setTextAlign('left').run()}><AlignLeft /></ToolbarButton>
            <ToolbarButton label={t('editor.rata_tengah', 'Centre')} active={editor.isActive({ textAlign: 'center' })} onClick={() => chain().setTextAlign('center').run()}><AlignCenter /></ToolbarButton>
            <ToolbarButton label={t('editor.rata_kanan', 'Align right')} active={editor.isActive({ textAlign: 'right' })} onClick={() => chain().setTextAlign('right').run()}><AlignRight /></ToolbarButton>
            <ToolbarButton label={t('editor.rata_kanan_kiri_justify', 'Justify')} active={editor.isActive({ textAlign: 'justify' })} onClick={() => chain().setTextAlign('justify').run()}><AlignJustify /></ToolbarButton>
            <RibbonMenu
              big={false}
              icon={<ArrowUpDown aria-hidden="true" />}
              label={t('ribbon.line_spacing', 'Line spacing')}
              options={[
                ...LINE_SPACINGS.map((value) => ({ value, label: value.replace('.', ','), checked: (blockAttributes.lineSpacing ?? null) === value })),
                { value: 'default', label: t('ribbon.line_spacing_default', 'Default'), checked: !blockAttributes.lineSpacing, separatorBefore: true },
              ]}
              onSelect={(value) => chain().setLineSpacing(value === 'default' ? null : value).run()}
            />
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_styles', 'Styles')}>
        <div className="flex items-stretch gap-g3" role="radiogroup" aria-label={t('ribbon.group_styles', 'Styles')}>
          {([
            { id: 'normal', label: t('ribbon.style_normal', 'Normal'), sample: 'text-xs' },
            { id: 'no-spacing', label: t('ribbon.style_no_spacing', 'No Spacing'), sample: 'text-xs' },
            { id: 'h1', label: t('ribbon.style_heading_1', 'Heading 1'), sample: 'text-base font-semibold text-primary' },
            { id: 'title', label: t('ribbon.style_title', 'Title'), sample: 'text-lg' },
            { id: 'h2', label: t('ribbon.style_heading_2', 'Heading 2'), sample: 'text-sm font-semibold text-primary' },
          ]).map((style) => (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={blockStyle === style.id}
              onClick={() => applyBlockStyle(style.id)}
              className={`flex h-g55 w-g68 flex-col items-center justify-between overflow-hidden rounded-sm border px-g3 py-g3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring ${blockStyle === style.id ? 'border-primary bg-muted' : 'border-transparent'}`}
            >
              <span data-sample className={`w-full truncate text-start leading-tight ${style.sample}`}>AaBbCc</span>
              <span className="w-full truncate text-xs text-muted-foreground">{style.label}</span>
            </button>
          ))}
        </div>
      </RibbonGroup>
    </>
  );

  const insertTab = (
    <>
      <RibbonGroup label={t('ribbon.group_pages', 'Pages')}>
        <Rows>
          <Button type="button" variant="ghost" size="sm" className="justify-start" disabled={pageOnly}
            onClick={() => chain().setPageBreak().setPageBreak().run()}>
            <FilePlus2 aria-hidden="true" />{t('ribbon.blank_page', 'Blank Page')}
          </Button>
          <Button type="button" variant="ghost" size="sm" className="justify-start" disabled={pageOnly} onClick={() => chain().setPageBreak().run()}>
            <SeparatorHorizontal aria-hidden="true" />{t('ribbon.page_break', 'Page Break')}
          </Button>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_tables', 'Tables')}>
        <Popover ids={{ trigger: 'editor-table-trigger' }} open={showTableMenu} onOpenChange={(details) => setShowTableMenu(details.open)} positioning={{ placement: 'bottom-start' }}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" className={bigButtonClass} aria-expanded={showTableMenu}>
              <Table aria-hidden="true" /><span className="inline-flex items-center gap-g2">{t('partners.table_view', 'Table')}<ChevronDown aria-hidden="true" className="size-g13" /></span>
            </Button>
          </PopoverTrigger>
          <PopoverPositioner>
            <PopoverContent className="w-fit min-w-0">
              <PopoverTitle className="sr-only">{t('partners.table_view', 'Table')}</PopoverTitle>
              <PopoverBody className="grid gap-g8">
                <TableGridPicker
                  onPick={(rows, cols) => {
                    chain().insertTable({ rows, cols, withHeaderRow: true }).run();
                    setShowTableMenu(false);
                  }}
                />
                {insideTable && (
                  <div className="grid gap-g2 border-t border-border pt-g8">
                    <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => { chain().addRowAfter().run(); setShowTableMenu(false); }}>
                      <Rows3 aria-hidden="true" />{t('editor.tambah_baris', 'Add row')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => { chain().addColumnAfter().run(); setShowTableMenu(false); }}>
                      <Columns3 aria-hidden="true" />{t('editor.tambah_kolom', 'Add column')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="justify-start" onClick={() => { chain().toggleHeaderRow().run(); setShowTableMenu(false); }}>
                      <Rows3 aria-hidden="true" />{t('editor.toggle_baris_header', 'Toggle header row')}
                    </Button>
                    <Separator className="my-g3" />
                    <Button type="button" variant="ghost" size="sm" className="justify-start" disabled={!editor.can().mergeCells()} onClick={() => { chain().mergeCells().run(); setShowTableMenu(false); }}>
                      <Combine aria-hidden="true" />{t('editor.gabung_sel_merge', 'Merge cells')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="justify-start" disabled={!editor.can().splitCell()} onClick={() => { chain().splitCell().run(); setShowTableMenu(false); }}>
                      <SplitSquareHorizontal aria-hidden="true" />{t('editor.pisah_sel_split', 'Split cell')}
                    </Button>
                    <div className="grid gap-g5 px-g8 py-g5">
                      <Text size="xs" weight="semibold" tone="muted" className="inline-flex items-center gap-g3">
                        <PaintBucket aria-hidden="true" className="size-g13" /> {t('editor.warna_sel', 'Cell colour')}
                      </Text>
                      <div className="flex items-center gap-g5">
                        {CELL_COLORS.map((c) => (
                          <Tooltip key={c.key}>
                            <TooltipTrigger asChild>
                              {/* Swatch fill is document content colour, not a UI token. */}
                              <Button type="button" variant="outline" size="icon-sm" aria-label={t(c.key, c.label)}
                                onClick={() => chain().setCellAttribute('backgroundColor', c.value).run()}
                                className="rounded-full" style={{ backgroundColor: c.value || undefined }} />
                            </TooltipTrigger>
                            <TooltipBody>{t(c.key, c.label)}</TooltipBody>
                          </Tooltip>
                        ))}
                      </div>
                    </div>
                    <Separator className="my-g3" />
                    <Button type="button" variant="ghost" size="sm" className="justify-start text-destructive" onClick={() => { chain().deleteRow().run(); setShowTableMenu(false); }}>
                      <Trash2 aria-hidden="true" />{t('editor.hapus_baris', 'Delete row')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="justify-start text-destructive" onClick={() => { chain().deleteColumn().run(); setShowTableMenu(false); }}>
                      <Trash2 aria-hidden="true" />{t('editor.hapus_kolom', 'Delete column')}
                    </Button>
                    <Button type="button" variant="ghost" size="sm" className="justify-start text-destructive" onClick={() => { chain().deleteTable().run(); setShowTableMenu(false); }}>
                      <Trash2 aria-hidden="true" />{t('editor.hapus_seluruh_tabel', 'Delete table')}
                    </Button>
                  </div>
                )}
              </PopoverBody>
            </PopoverContent>
          </PopoverPositioner>
        </Popover>
        <Rows>
          <ToolbarButton label={t('editor.pricing_table.insert', 'Insert pricing table')} onClick={handleInsertPricingTable}><Sigma /></ToolbarButton>
          <ToolbarButton label={t('editor.pricing_table.recalculate', 'Recalculate totals')} onClick={handleRecalculatePricingTable} disabled={!insideTable}><Calculator /></ToolbarButton>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_illustrations', 'Illustrations')}>
        <BigButton icon={<ImagePlus aria-hidden="true" />} label={t('ribbon.pictures', 'Pictures')} onClick={() => pictureInput.current?.click()} />
        <input
          ref={pictureInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
          multiple
          hidden
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            void insertImageFiles(editor, files, undefined, (error) => showAlert({
              title: error instanceof ImageTooLargeError ? t('editor.image_too_large', 'The picture is larger than 15 MB.') : t('editor.image_failed', 'The picture could not be read.'),
              variant: 'destructive',
            }));
          }}
        />
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_links', 'Links')}>
        <Popover ids={{ trigger: 'editor-link-trigger' }} open={linkOpen} onOpenChange={(details) => {
          setLinkOpen(details.open);
          if (details.open) setLinkUrl((editor.getAttributes('link').href as string | undefined) || 'https://');
        }}>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" className={bigButtonClass} aria-pressed={editor.isActive('link')}>
              <Link2 aria-hidden="true" /><span>{t('editor.tautan_link', 'Link')}</span>
            </Button>
          </PopoverTrigger>
          <PopoverPositioner>
            <PopoverContent>
              <form onSubmit={(event) => { event.preventDefault(); setLink(linkUrl.trim()); }} className="grid gap-g13">
                <PopoverTitle>{t('editor.tautan_link', 'Link')}</PopoverTitle>
                <Field>
                  <FieldLabel htmlFor={linkInputId}>{t('editor.masukkan_url_tautan', 'Enter the link URL:')}</FieldLabel>
                  <Input id={linkInputId} type="url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} autoFocus />
                </Field>
                <PopoverFooter className="mt-0">
                  <Button type="button" variant="outline" size="sm" onClick={() => setLinkOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
                  <Button type="submit" size="sm">{t('admin.btn_apply', 'Apply')}</Button>
                </PopoverFooter>
              </form>
            </PopoverContent>
          </PopoverPositioner>
        </Popover>
        <ToolbarButton label={t('editor.hapus_tautan', 'Remove link')} disabled={!editor.isActive('link')} onClick={() => chain().unsetLink().run()}><Unlink /></ToolbarButton>
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_text', 'Text')}>
        <Rows>
          <Row>
            <ToolbarButton label={t('editor.garis_horizontal', 'Horizontal line')} onClick={() => chain().setHorizontalRule().run()}><Minus /></ToolbarButton>
            <ToolbarButton label={t('editor.kutipan_blockquote', 'Quote')} active={editor.isActive('blockquote')} onClick={() => chain().toggleBlockquote().run()}><Quote /></ToolbarButton>
          </Row>
          <Row>
            <ToolbarButton label={t('editor.blok_kode', 'Code block')} active={editor.isActive('codeBlock')} onClick={() => chain().toggleCodeBlock().run()}><Code2 /></ToolbarButton>
          </Row>
        </Rows>
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_header_footer', 'Header & Footer')}>
        {headerFooterMenu('header')}
        {headerFooterMenu('footer')}
        <RibbonMenu
          icon={<Hash aria-hidden="true" />}
          label={t('ribbon.page_number', 'Page Number')}
          options={[
            { value: 'top', label: t('ribbon.page_number_top', 'Top of Page') },
            { value: 'bottom', label: t('ribbon.page_number_bottom', 'Bottom of Page') },
            { value: 'x_of_y', label: t('ribbon.page_x_of_y', 'Page X of Y') },
            { value: 'current', label: t('ribbon.page_number_current', 'Current Position'), hint: t('ribbon.page_number_current_hint', 'While editing a header or footer') },
          ]}
          onSelect={(value) => {
            if (value === 'top') setHeaderFooter('header', CENTERED_PAGE_NUMBER);
            else if (value === 'bottom') setHeaderFooter('footer', CENTERED_PAGE_NUMBER);
            else if (value === 'x_of_y') setHeaderFooter('footer', pageXOfY);
            else if (editingHeaderFooter) chain().insertPageNumber('page').run();
            else {
              showAlert({ title: t('ribbon.page_number_current_hint_long', 'Double-click a header or footer first, then place the cursor where the number goes.'), variant: 'warning' });
            }
          }}
        />
      </RibbonGroup>
    </>
  );

  const layoutTab = (
    <>
      <RibbonGroup label={t('ribbon.group_page_setup', 'Page Setup')}>
        <RibbonMenu
          icon={<Columns2 aria-hidden="true" />}
          label={t('page.margins', 'Margins')}
          options={[
            ...(Object.keys(MARGIN_PRESETS) as Array<keyof typeof MARGIN_PRESETS>).map((key) => {
              const preset = MARGIN_PRESETS[key];
              return {
                value: key,
                label: t(`page.margin_${key}`, key[0].toUpperCase() + key.slice(1)),
                hint: `${t('page.top', 'Top')} ${cm(preset.top)} · ${t('page.bottom', 'Bottom')} ${cm(preset.bottom)} · ${t('page.left', 'Left')} ${cm(preset.left)} · ${t('page.right', 'Right')} ${cm(preset.right)}`,
                checked: sameMargins(preset, layout.margins),
              };
            }),
            { value: 'custom', label: `${t('page.custom_margins', 'Custom Margins')}…`, separatorBefore: true },
          ]}
          onSelect={(value) => {
            if (value === 'custom') onOpenPageSetup();
            else onLayoutChange({ ...layout, margins: { ...MARGIN_PRESETS[value as keyof typeof MARGIN_PRESETS] } });
          }}
        />
        <RibbonMenu
          icon={layout.orientation === 'portrait' ? <RectangleVertical aria-hidden="true" /> : <RectangleHorizontal aria-hidden="true" />}
          label={t('page.orientation', 'Orientation')}
          options={[
            { value: 'portrait', label: t('page.portrait', 'Portrait'), checked: layout.orientation === 'portrait' },
            { value: 'landscape', label: t('page.landscape', 'Landscape'), checked: layout.orientation === 'landscape' },
          ]}
          onSelect={(value) => onLayoutChange({ ...layout, orientation: value === 'landscape' ? 'landscape' : 'portrait' })}
        />
        <RibbonMenu
          icon={<FileText aria-hidden="true" />}
          label={t('page.size', 'Size')}
          options={(Object.keys(PAPER_MM) as PaperSize[]).map((paper) => ({
            value: paper,
            label: paper === 'A4' ? 'A4' : paper[0] + paper.slice(1).toLowerCase(),
            hint: `${cm(PAPER_MM[paper].width)} x ${cm(PAPER_MM[paper].height)}`,
            checked: layout.paper === paper,
          }))}
          onSelect={(value) => onLayoutChange({ ...layout, paper: value as PaperSize })}
        />
        <RibbonMenu
          icon={<SeparatorHorizontal aria-hidden="true" />}
          label={t('ribbon.breaks', 'Breaks')}
          options={[{ value: 'page', label: t('ribbon.page_break', 'Page Break'), hint: 'Ctrl+Enter', disabled: pageOnly }]}
          onSelect={() => chain().setPageBreak().run()}
        />
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_paragraph', 'Paragraph')}>
        <Rows>
          <Text as="span" size="xs" weight="semibold" tone="muted">{t('ribbon.indent', 'Indent')}</Text>
          <CmField label={t('page.left', 'Left')} valueMm={Number(blockAttributes.indentLeft ?? 0)} onApply={(mm) => chain().setParagraphIndent({ left: mm || null }).run()} />
          <CmField label={t('page.right', 'Right')} valueMm={Number(blockAttributes.indentRight ?? 0)} onApply={(mm) => chain().setParagraphIndent({ right: mm || null }).run()} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const viewTab = (
    <>
      <RibbonGroup label={t('ribbon.group_show', 'Show')}>
        <Toggle variant="ghost" size="sm" pressed={showRuler} onPressedChange={onToggleRuler} aria-label={t('ribbon.ruler', 'Ruler')}>
          <Ruler aria-hidden="true" />{t('ribbon.ruler', 'Ruler')}
        </Toggle>
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_zoom', 'Zoom')}>
        <NativeSelect aria-label={t('ribbon.group_zoom', 'Zoom')} value={String(ZOOM_LEVELS.includes(zoom) ? zoom : 100)} onChange={(event) => onZoomChange(Number(event.target.value))} controlProps={{ className: 'w-g144' }}>
          {ZOOM_LEVELS.map((level) => <option key={level} value={level}>{level}%</option>)}
        </NativeSelect>
      </RibbonGroup>
    </>
  );

  const picture = editor.getAttributes('image') as { wrap?: ImageWrap; align?: ImageAlign; width?: number | null; alt?: string | null };
  const wrap: ImageWrap = picture.wrap ?? 'inline';
  const wrapLabels: Record<ImageWrap, string> = {
    inline: t('ribbon.wrap_inline', 'In Line with Text'),
    square: t('ribbon.wrap_square', 'Square'),
    tight: t('ribbon.wrap_tight', 'Tight'),
    through: t('ribbon.wrap_through', 'Through'),
    topBottom: t('ribbon.wrap_top_bottom', 'Top and Bottom'),
    behind: t('ribbon.wrap_behind', 'Behind Text'),
    front: t('ribbon.wrap_front', 'In Front of Text'),
  };
  const pictureTab = (
    <>
      <RibbonGroup label={t('ribbon.group_arrange', 'Arrange')}>
        <RibbonMenu
          icon={<WrapText aria-hidden="true" />}
          label={t('ribbon.wrap_text', 'Wrap Text')}
          options={IMAGE_WRAPS.map((value) => ({ value, label: wrapLabels[value], checked: wrap === value }))}
          onSelect={(value) => chain().setImageWrap(value as ImageWrap).run()}
        />
        <RibbonMenu
          icon={<AlignHorizontalJustifyCenter aria-hidden="true" />}
          label={t('ribbon.align', 'Align')}
          options={(['left', 'center', 'right'] as const).map((value) => ({
            value,
            label: { left: t('ribbon.align_left', 'Align Left'), center: t('ribbon.align_center', 'Align Center'), right: t('ribbon.align_right', 'Align Right') }[value],
            checked: wrap !== 'inline' && (picture.align ?? 'left') === value,
            // In line pictures follow the paragraph alignment; text cannot flow on both sides of a centred picture.
            disabled: wrap === 'inline' || FREE_WRAPS.has(wrap) || (value === 'center' && SIDE_WRAPS.has(wrap)),
          }))}
          onSelect={(value) => chain().setImageAlign(value as ImageAlign).run()}
        />
      </RibbonGroup>
      <RibbonGroup label={t('ribbon.group_size', 'Size')}>
        <Rows>
          <CmField label={t('ribbon.width', 'Width')} valueMm={pxToMm(Number(picture.width) || 0)} onApply={(mm) => { if (mm > 0) chain().setImageWidth(mmToPx(mm)).run(); }} />
          <AltTextField label={t('ribbon.alt_text', 'Alt text')} value={picture.alt ?? ''} onApply={(alt) => chain().setImageAlt(alt).run()} />
        </Rows>
      </RibbonGroup>
    </>
  );

  const tabs: Array<{ id: RibbonTab; label: string }> = [
    { id: 'home', label: t('ribbon.tab_home', 'Home') },
    { id: 'insert', label: t('ribbon.tab_insert', 'Insert') },
    { id: 'layout', label: t('ribbon.tab_layout', 'Layout') },
    { id: 'view', label: t('ribbon.tab_view', 'View') },
    ...(pictureSelected ? [{ id: 'picture' as const, label: t('ribbon.tab_picture', 'Picture Format') }] : []),
  ];

  const moveTab = (event: React.KeyboardEvent, index: number) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = tabs[(index + step + tabs.length) % tabs.length].id;
    setTab(next);
    document.getElementById(`${tabsId}-${next}`)?.focus();
  };

  return (
    <div role="toolbar" aria-label={t('editor.toolbar', 'Document formatting')} className="z-10 shrink-0 border-b border-border bg-card [&_*:not([data-sample])]:text-[12px] [&_svg]:[stroke-width:1.5]">
      {/* Flat tab bar: plain labels, the active one underlined, like Word on the web. */}
      <div role="tablist" aria-label={t('editor.toolbar', 'Document formatting')} className="flex items-end gap-g3 border-b border-border bg-muted/40 px-g8">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            id={`${tabsId}-${item.id}`}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            aria-controls={`${tabsId}-panel`}
            tabIndex={tab === item.id ? 0 : -1}
            onClick={() => setTab(item.id)}
            onKeyDown={(event) => moveTab(event, index)}
            className={`-mb-px border-b-2 px-g8 pb-g5 pt-g8 text-sm transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring ${
              tab === item.id ? 'border-primary font-semibold text-foreground' : 'border-transparent text-foreground hover:text-primary'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div id={`${tabsId}-panel`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`} className="flex min-h-g89 items-stretch overflow-x-auto px-g5 py-g3">
        {tab === 'home' && homeTab}
        {tab === 'insert' && insertTab}
        {tab === 'layout' && layoutTab}
        {tab === 'view' && viewTab}
        {tab === 'picture' && pictureSelected && pictureTab}
      </div>
    </div>
  );
};
