import React, { useState, useEffect } from 'react';
import { useLanguage } from '../context/LanguageContext';
import { Calendar as CalendarIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@legalio/ui-components/popover';
import { Calendar } from '@legalio/ui-components/calendar';

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

function isoToDate(iso: string): Date | undefined {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return undefined;
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function dateToIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const DateInput: React.FC<DateInputProps> = ({
  value,
  onChange,
  placeholder = 'dd/mm/yyyy',
  required = false,
  disabled = false,
  className = '',
  focusColor = 'indigo',
  min,
  max,
  id,
  name,
}) => {
  const { t } = useLanguage();
  const [displayValue, setDisplayValue] = useState<string>(() => formatIsoToDdMmYyyy(value));
  const [popoverOpen, setPopoverOpen] = useState(false);

  // Sync internal displayValue when parent value changes
  useEffect(() => {
    setDisplayValue(formatIsoToDdMmYyyy(value));
  }, [value]);

  const handleTextChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawInput = e.target.value;

    // Filter out non-digit and non-slash characters
    let cleaned = rawInput.replace(/[^\d/]/g, '');

    // Auto-format digits with slashes if user types numbers sequentially
    const digitsOnly = cleaned.replace(/\D/g, '');
    let formatted = '';
    if (digitsOnly.length > 0) {
      if (digitsOnly.length <= 2) {
        formatted = digitsOnly;
      } else if (digitsOnly.length <= 4) {
        formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2)}`;
      } else {
        formatted = `${digitsOnly.slice(0, 2)}/${digitsOnly.slice(2, 4)}/${digitsOnly.slice(4, 8)}`;
      }
    } else {
      formatted = '';
    }

    setDisplayValue(formatted);

    if (formatted.length === 10) {
      const iso = formatDdMmYyyyToIso(formatted);
      if (iso) {
        onChange(iso);
      }
    } else if (formatted === '') {
      onChange('');
    }
  };

  const handleBlur = () => {
    if (displayValue.length === 10) {
      const iso = formatDdMmYyyyToIso(displayValue);
      if (iso) {
        onChange(iso);
      }
    } else if (displayValue !== '') {
      // If incomplete or invalid, revert to parent value or reset
      setDisplayValue(formatIsoToDdMmYyyy(value));
    }
  };

  const handleCalendarSelect = (date: Date | undefined) => {
    if (!date) return;
    const iso = dateToIso(date);
    setDisplayValue(formatIsoToDdMmYyyy(iso));
    onChange(iso);
    setPopoverOpen(false);
  };

  const focusBorderClass =
    focusColor === 'emerald'
      ? 'focus-within:border-accent focus:border-accent'
      : focusColor === 'slate'
      ? 'focus-within:border-hairline focus:border-hairline'
      : 'focus-within:border-accent focus:border-accent';

  const selectedDate = isoToDate(formatDdMmYyyyToIso(value) || value);
  const minDate = min ? isoToDate(min) : undefined;
  const maxDate = max ? isoToDate(max) : undefined;

  return (
    <div className={`relative flex items-center ${className}`}>
      <input
        type="text"
        id={id}
        name={name}
        required={required}
        disabled={disabled}
        placeholder={placeholder}
        value={displayValue}
        onChange={handleTextChange}
        onBlur={handleBlur}
        maxLength={10}
        className={`ds-input w-full pl-3 pr-9 ${focusBorderClass}  ${
          disabled ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      />
      <Popover open={popoverOpen} onOpenChange={(open) => !disabled && setPopoverOpen(open)}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            title={t('common.buka_kalender', 'Buka Kalender')}
            aria-label={t('common.buka_kalender', 'Buka Kalender')}
            className="absolute right-2.5 text-ink-soft hover:text-accent-text transition-colors cursor-pointer disabled:cursor-not-allowed p-0.5"
          >
            <CalendarIcon className="w-4 h-4" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleCalendarSelect}
            disabled={
              minDate || maxDate
                ? [
                    ...(minDate ? [{ before: minDate }] : []),
                    ...(maxDate ? [{ after: maxDate }] : []),
                  ]
                : undefined
            }
            defaultMonth={selectedDate}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </div>
  );
};
