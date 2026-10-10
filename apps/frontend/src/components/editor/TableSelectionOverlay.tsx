import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { GripVertical, GripHorizontal, Combine, SplitSquareHorizontal, Trash2, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

interface HandleRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface SelectionInfo {
  rowFrom: number;
  rowTo: number;
  colFrom: number;
  colTo: number;
}

/**
 * Row/column "grip" handles for the table the cursor is currently inside, plus a
 * floating menu (merge/split/color/align/delete) shown while a whole row or
 * column is selected. Everything here is a read-only DOM overlay positioned via
 * `getBoundingClientRect()` and only ever calls the table extension's own
 * commands (setCellSelection/mergeCells/splitCell/setCellAttribute/deleteRow/
 * deleteColumn) — it never touches the node schema, so it can't reintroduce the
 * "table renders at width:0" bug that came from patching node attributes.
 */
export const TableSelectionOverlay: React.FC<{
  editor: Editor | null;
  containerRef: React.RefObject<HTMLElement | null>;
}> = ({ editor, containerRef }) => {
  const { t } = useLanguage();
  const [rowHandle, setRowHandle] = useState<HandleRect | null>(null);
  const [colHandle, setColHandle] = useState<HandleRect | null>(null);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);

  const recompute = useCallback(() => {
    if (!editor || !containerRef.current) {
      setRowHandle(null);
      setColHandle(null);
      setSelectionInfo(null);
      return;
    }

    const { state, view } = editor;
    const $pos = state.selection.$from;

    let tableNode: ReturnType<typeof $pos.node> | null = null;
    let tablePos = -1;
    let cellPos = -1;

    for (let d = $pos.depth; d > 0; d--) {
      const node = $pos.node(d);
      if (node.type.name === 'table' && tablePos === -1) {
        tableNode = node;
        tablePos = $pos.before(d);
      }
      if ((node.type.name === 'tableCell' || node.type.name === 'tableHeader') && cellPos === -1) {
        cellPos = $pos.before(d);
      }
    }

    if (!tableNode || cellPos === -1) {
      setRowHandle(null);
      setColHandle(null);
      setSelectionInfo(null);
      return;
    }

    const map = TableMap.get(tableNode);
    const tableContentStart = tablePos + 1;
    const rect = map.findCell(cellPos - tableContentStart);

    const rowFrom = tableContentStart + map.positionAt(rect.top, 0, tableNode);
    const rowTo = tableContentStart + map.positionAt(rect.top, map.width - 1, tableNode);
    const colFrom = tableContentStart + map.positionAt(0, rect.left, tableNode);
    const colTo = tableContentStart + map.positionAt(map.height - 1, rect.left, tableNode);

    setSelectionInfo({ rowFrom, rowTo, colFrom, colTo });

    const containerRect = containerRef.current.getBoundingClientRect();

    const rowCellDom = view.nodeDOM(rowFrom) as HTMLElement | null;
    setRowHandle(
      rowCellDom
        ? {
            top: rowCellDom.getBoundingClientRect().top - containerRect.top,
            left: rowCellDom.getBoundingClientRect().left - containerRect.left,
            width: rowCellDom.getBoundingClientRect().width,
            height: rowCellDom.getBoundingClientRect().height,
          }
        : null
    );

    const colCellDom = view.nodeDOM(colFrom) as HTMLElement | null;
    setColHandle(
      colCellDom
        ? {
            top: colCellDom.getBoundingClientRect().top - containerRect.top,
            left: colCellDom.getBoundingClientRect().left - containerRect.left,
            width: colCellDom.getBoundingClientRect().width,
            height: colCellDom.getBoundingClientRect().height,
          }
        : null
    );
  }, [editor, containerRef]);

  useEffect(() => {
    if (!editor) return;
    recompute();
    editor.on('selectionUpdate', recompute);
    editor.on('transaction', recompute);
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      editor.off('selectionUpdate', recompute);
      editor.off('transaction', recompute);
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [editor, recompute]);

  if (!editor) return null;

  return (
    <>
      {rowHandle && (
        <button
          type="button"
          contentEditable={false}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            selectionInfo &&
            editor.chain().focus().setCellSelection({ anchorCell: selectionInfo.rowFrom, headCell: selectionInfo.rowTo }).run()
          }
          title={t('editor.pilih_seluruh_baris', 'Pilih seluruh baris')}
          style={{ top: rowHandle.top, left: rowHandle.left - 18, height: Math.max(rowHandle.height, 16) }}
          className="absolute w-4 flex items-center justify-center rounded-md bg-surface-2 text-ink-soft hover:bg-status-success-soft dark:hover:bg-status-success-soft/60 hover:text-status-success dark:hover:text-status-success z-20 cursor-pointer transition-colors"
        >
          <GripVertical className="w-3 h-3" />
        </button>
      )}
      {colHandle && (
        <button
          type="button"
          contentEditable={false}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            selectionInfo &&
            editor.chain().focus().setCellSelection({ anchorCell: selectionInfo.colFrom, headCell: selectionInfo.colTo }).run()
          }
          title={t('editor.pilih_seluruh_kolom', 'Pilih seluruh kolom')}
          style={{ top: colHandle.top - 16, left: colHandle.left, width: Math.max(colHandle.width, 16) }}
          className="absolute h-4 flex items-center justify-center rounded-md bg-surface-2 text-ink-soft hover:bg-status-success-soft dark:hover:bg-status-success-soft/60 hover:text-status-success dark:hover:text-status-success z-20 cursor-pointer transition-colors"
        >
          <GripHorizontal className="w-3 h-3" />
        </button>
      )}

      <BubbleMenu
        editor={editor}
        pluginKey="tableCellSelectionMenu"
        shouldShow={({ state }) => state.selection instanceof CellSelection}
        options={{ placement: 'top', offset: 8 }}
      >
        <div className="ds-panel flex items-center gap-0.5 p-1">
          <button
            type="button"
            disabled={!editor.can().mergeCells()}
            onClick={() => editor.chain().focus().mergeCells().run()}
            title={t('editor.gabung_sel', 'Gabung Sel')}
            className="inline-flex items-center justify-center size-8 rounded-md text-ink-soft dark:text-ink hover:bg-surface-2 dark:hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Combine className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!editor.can().splitCell()}
            onClick={() => editor.chain().focus().splitCell().run()}
            title={t('editor.pisah_sel', 'Pisah Sel')}
            className="inline-flex items-center justify-center size-8 rounded-md text-ink-soft dark:text-ink hover:bg-surface-2 dark:hover:bg-surface-2 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <SplitSquareHorizontal className="w-3.5 h-3.5" />
          </button>

          <div className="w-px self-stretch bg-surface-2 mx-0.5" />

          <button
            type="button"
            onClick={() => editor.chain().focus().setCellAttribute('align', 'left').run()}
            title={t('editor.rata_kiri', 'Rata Kiri')}
            className="inline-flex items-center justify-center size-8 rounded-md text-ink-soft dark:text-ink hover:bg-surface-2 dark:hover:bg-surface-2"
          >
            <AlignLeft className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().setCellAttribute('align', 'center').run()}
            title={t('editor.rata_tengah', 'Rata Tengah')}
            className="inline-flex items-center justify-center size-8 rounded-md text-ink-soft dark:text-ink hover:bg-surface-2 dark:hover:bg-surface-2"
          >
            <AlignCenter className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => editor.chain().focus().setCellAttribute('align', 'right').run()}
            title={t('editor.rata_kanan', 'Rata Kanan')}
            className="inline-flex items-center justify-center size-8 rounded-md text-ink-soft dark:text-ink hover:bg-surface-2 dark:hover:bg-surface-2"
          >
            <AlignRight className="w-3.5 h-3.5" />
          </button>

          <div className="w-px self-stretch bg-surface-2 mx-0.5" />

          <div className="flex items-center gap-1 px-1">
            {['transparent', '#f1f5f9', '#fee2e2', '#fef9c3', '#dcfce7', '#dbeafe', '#ede9fe'].map((color) => (
              <button
                key={color}
                type="button"
                title={color === 'transparent' ? t('editor.tanpa_warna', 'Tanpa warna') : color}
                onClick={() =>
                  editor
                    .chain()
                    .focus()
                    .setCellAttribute('backgroundColor', color === 'transparent' ? null : color)
                    .run()
                }
                className="w-4 h-4 rounded-full border border-hairline shrink-0"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>

          <div className="w-px self-stretch bg-surface-2 mx-0.5" />

          <button
            type="button"
            onClick={() => editor.chain().focus().deleteRow().run()}
            title={t('editor.hapus_baris', 'Hapus Baris')}
            className="inline-flex items-center justify-center size-8 rounded-md text-status-danger hover:bg-status-danger-soft dark:hover:bg-status-danger-soft/30"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </BubbleMenu>
    </>
  );
};
