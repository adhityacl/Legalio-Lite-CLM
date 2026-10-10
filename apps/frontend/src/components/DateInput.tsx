import React from 'react';
import {
  DatePicker, DatePickerContent, DatePickerContext, DatePickerDayTable, DatePickerField, DatePickerNextTrigger, DatePickerPositioner,
  DatePickerPrevTrigger, DatePickerTable, DatePickerTableBody, DatePickerTableCell, DatePickerTableCellTrigger, DatePickerTableRow,
  DatePickerView, DatePickerViewControl, DatePickerViewTrigger, parseDate, type DateValue,
} from '@legalio/ui-components/date-picker';
export interface DateInputProps {
  value: string; // ISO format YYYY-MM-DD or DD/MM/YYYY
  onChange: (isoDate: string) => void;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
  focusColor?: 'indigo' | 'emerald' | 'slate';
  min?: string;
  max?: string;
  id?: string;
  name?: string;
}

/**
 * Converts YYYY-MM-DD to DD/MM/YYYY
 */
export function formatIsoToDdMmYyyy(isoStr: string): string {
  if (!isoStr) return '';
  // If already DD/MM/YYYY format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(isoStr)) {
    return isoStr;
  }
  const match = isoStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const y = match[1];
    const m = match[2].padStart(2, '0');
    const d = match[3].padStart(2, '0');
    return `${d}/${m}/${y}`;
  }
  return isoStr;
}

/**
 * Converts DD/MM/YYYY to YYYY-MM-DD
 */
export function formatDdMmYyyyToIso(ddmmStr: string): string {
  if (!ddmmStr) return '';
  // If already YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(ddmmStr)) {
    return ddmmStr;
  }
  const match = ddmmStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) {
    const d = match[1].padStart(2, '0');
    const m = match[2].padStart(2, '0');
    const y = match[3];
    const dayNum = parseInt(d, 10);
    const monthNum = parseInt(m, 10);
    const yearNum = parseInt(y, 10);
    if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12 && yearNum >= 1000) {
      return `${y}-${m}-${d}`;
    }
  }
  return '';
}

function toDateValue(iso: string | undefined): DateValue | undefined {
  const normalized = iso && (formatDdMmYyyyToIso(iso) || iso);
  if (!normalized || !/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined;
  try { return parseDate(normalized); } catch { return undefined; }
}

/** Month and year grids shared by the picker views. */
function GridView({ view }: { view: 'month' | 'year' }) {
  return (
    <DatePickerView view={view}>
      <DatePickerContext>
        {picker => (
          <>
            <DatePickerViewControl>
              <DatePickerPrevTrigger />
              <DatePickerViewTrigger />
              <DatePickerNextTrigger />
            </DatePickerViewControl>
            <DatePickerTable columns={4}>
              <DatePickerTableBody>
                {(view === 'month' ? picker.getMonthsGrid({ columns: 4, format: 'short' }) : picker.getYearsGrid({ columns: 4 })).map((row, rowIndex) => (
                  <DatePickerTableRow key={rowIndex}>
                    {row.map(cell => (
                      <DatePickerTableCell key={cell.value} value={cell.value} disabled={cell.disabled}>
                        <DatePickerTableCellTrigger>{cell.label}</DatePickerTableCellTrigger>
                      </DatePickerTableCell>
                    ))}
                  </DatePickerTableRow>
                ))}
              </DatePickerTableBody>
            </DatePickerTable>
          </>
        )}
      </DatePickerContext>
    </DatePickerView>
  );
}

/**
 * Business date field (dd/mm/yyyy) on the moduix DatePicker: typed entry, popup calendar,
 * month and year views, and min/max bounds. Values in and out stay ISO (YYYY-MM-DD).
 */
export const DateInput: React.FC<DateInputProps> = ({ value, onChange, placeholder = 'dd/mm/yyyy', required = false, disabled = false, className, min, max, id, name }) => {
  const selected = toDateValue(value);
  return (
    <DatePicker
      className={className}
      locale="en-GB"
      ids={id ? { input: () => id } : undefined}
      name={name}
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      min={toDateValue(min)}
      max={toDateValue(max)}
      value={selected ? [selected] : []}
      onValueChange={details => onChange(details.value[0]?.toString() ?? '')}
    >
      <DatePickerField />
      <DatePickerPositioner>
        <DatePickerContent>
          <DatePickerView view="day"><DatePickerDayTable /></DatePickerView>
          <GridView view="month" />
          <GridView view="year" />
        </DatePickerContent>
      </DatePickerPositioner>
    </DatePicker>
  );
};
