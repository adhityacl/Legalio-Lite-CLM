import React, { useCallback, useEffect, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import type { Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { CellSelection, TableMap } from '@tiptap/pm/tables';
import { GripVertical, GripHorizontal, Combine, SplitSquareHorizontal, Trash2, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

import { Button } from '@legalio/ui-components/button';
import { Card } from '@legalio/ui-components/card';
import { Separator } from '@legalio/ui-components/separator';
import { Tooltip, TooltipBody, TooltipTrigger } from '@legalio/ui-components/tooltip';
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
        <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="icon-md"
          type="button"
          contentEditable={false}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            selectionInfo &&
            editor.chain().focus().setCellSelection({ anchorCell: selectionInfo.rowFrom, headCell: selectionInfo.rowTo }).run()
          } aria-label={t('editor.pilih_seluruh_baris', 'Pilih seluruh baris')}
          style={{ top: rowHandle.top, left: rowHandle.left - 18, height: Math.max(rowHandle.height, 16) }}
          className="absolute z-20"
        >
          <GripVertical aria-hidden="true" />
        </Button></TooltipTrigger><TooltipBody>{t('editor.pilih_seluruh_baris', 'Pilih seluruh baris')}</TooltipBody></Tooltip>
      )}
      {colHandle && (
        <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="icon-md"
          type="button"
          contentEditable={false}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() =>
            selectionInfo &&
            editor.chain().focus().setCellSelection({ anchorCell: selectionInfo.colFrom, headCell: selectionInfo.colTo }).run()
          } aria-label={t('editor.pilih_seluruh_kolom', 'Pilih seluruh kolom')}
          style={{ top: colHandle.top - 16, left: colHandle.left, width: Math.max(colHandle.width, 16) }}
          className="absolute z-20"
        >
          <GripHorizontal aria-hidden="true" />
        </Button></TooltipTrigger><TooltipBody>{t('editor.pilih_seluruh_kolom', 'Pilih seluruh kolom')}</TooltipBody></Tooltip>
      )}

      <BubbleMenu
        editor={editor}
        pluginKey="tableCellSelectionMenu"
        shouldShow={({ state }) => state.selection instanceof CellSelection}
        options={{ placement: 'top', offset: 8 }}
      >
        <Card role="toolbar" aria-label={t('editor.table_tools', 'Alat tabel')} className="flex-row items-center gap-g2 p-g3">
          <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="icon-sm"
            type="button"
            disabled={!editor.can().mergeCells()}
            onClick={() => editor.chain().focus().mergeCells().run()} aria-label={t('editor.gabung_sel', 'Gabung Sel')}
          >
            <Combine aria-hidden="true" />
          </Button></TooltipTrigger><TooltipBody>{t('editor.gabung_sel', 'Gabung Sel')}</TooltipBody></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="icon-sm"
            type="button"
            disabled={!editor.can().splitCell()}
            onClick={() => editor.chain().focus().splitCell().run()} aria-label={t('editor.pisah_sel', 'Pisah Sel')}
          >
            <SplitSquareHorizontal aria-hidden="true" />
          </Button></TooltipTrigger><TooltipBody>{t('editor.pisah_sel', 'Pisah Sel')}</TooltipBody></Tooltip>

          <Separator orientation="vertical" className="mx-g2 self-stretch" />

          <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="icon-sm"
            type="button"
            onClick={() => editor.chain().focus().setCellAttribute('align', 'left').run()} aria-label={t('editor.rata_kiri', 'Rata Kiri')}
          >
            <AlignLeft aria-hidden="true" />
          </Button></TooltipTrigger><TooltipBody>{t('editor.rata_kiri', 'Rata Kiri')}</TooltipBody></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="icon-sm"
            type="button"
            onClick={() => editor.chain().focus().setCellAttribute('align', 'center').run()} aria-label={t('editor.rata_tengah', 'Rata Tengah')}
          >
            <AlignCenter aria-hidden="true" />
          </Button></TooltipTrigger><TooltipBody>{t('editor.rata_tengah', 'Rata Tengah')}</TooltipBody></Tooltip>
          <Tooltip><TooltipTrigger asChild><Button variant="secondary" size="icon-sm"
            type="button"
            onClick={() => editor.chain().focus().setCellAttribute('align', 'right').run()} aria-label={t('editor.rata_kanan', 'Rata Kanan')}
          >
            <AlignRight aria-hidden="true" />
          </Button></TooltipTrigger><TooltipBody>{t('editor.rata_kanan', 'Rata Kanan')}</TooltipBody></Tooltip>

          <Separator orientation="vertical" className="mx-g2 self-stretch" />

          <div className="flex items-center gap-g3 px-g3">
            {/* Swatch fills are document content colours stored on the cell, not UI tokens. */}
            {[null, '#f1f5f9', '#fee2e2', '#fef9c3', '#dcfce7', '#dbeafe', '#ede9fe'].map((color) => (
              <Tooltip key={color || 'none'}><TooltipTrigger asChild><Button type="button" variant="outline" size="icon-sm" className="rounded-full" aria-label={color ? color : t('editor.tanpa_warna', 'Tanpa warna')}
                onClick={() => editor.chain().focus().setCellAttribute('backgroundColor', color).run()}
                style={{ backgroundColor: color || undefined }} /></TooltipTrigger><TooltipBody>{color ? color : t('editor.tanpa_warna', 'Tanpa warna')}</TooltipBody></Tooltip>
            ))}
          </div>

          <Separator orientation="vertical" className="mx-g2 self-stretch" />

          <Tooltip><TooltipTrigger asChild><Button variant="ghost" size="icon-sm"
            type="button"
            onClick={() => editor.chain().focus().deleteRow().run()} aria-label={t('editor.hapus_baris', 'Hapus Baris')}
            className="text-destructive"
          >
            <Trash2 aria-hidden="true" />
          </Button></TooltipTrigger><TooltipBody>{t('editor.hapus_baris', 'Hapus Baris')}</TooltipBody></Tooltip>
        </Card>
      </BubbleMenu>
    </>
  );
};
