import React, { useId, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { localize, type DueDiligenceOverride, type DueDiligenceRequirement } from '@legalio/shared/policy';

export interface DueDiligenceChecklistEditorProps {
  /** Pack-provided items (core + country + industry), as returned by the server. */
  packItems: Array<DueDiligenceRequirement & { disabled?: boolean }>;
  overrides: Record<string, DueDiligenceOverride>;
  customItems: DueDiligenceRequirement[];
  onChange: (next: { overrides: Record<string, DueDiligenceOverride>; customItems: DueDiligenceRequirement[] }) => void;
  disabled?: boolean;
}

const SOURCE_KEY: Record<string, string> = {
  core: 'settings.region.dd_source_core',
  country: 'settings.region.dd_source_country',
  industry: 'settings.region.dd_source_industry',
  tenant: 'settings.region.dd_source_tenant',
};

function slugKey(label: string): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'item';
  return `custom_${base}`;
}

/**
 * Lets an administrator tailor the due-diligence checklist without code
 * changes (PRD §3.2.1): toggle "required", hide pack items, add custom items.
 */
export const DueDiligenceChecklistEditor: React.FC<DueDiligenceChecklistEditorProps> = ({
  packItems,
  overrides,
  customItems,
  onChange,
  disabled,
}) => {
  const { t, language } = useLanguage();
  const [newLabel, setNewLabel] = useState('');
  const newLabelId = useId();
  const packOnly = packItems.filter((item) => item.source !== 'tenant');

  const setOverride = (key: string, patch: DueDiligenceOverride) => {
    onChange({ overrides: { ...overrides, [key]: { ...overrides[key], ...patch } }, customItems });
  };

  const addCustom = () => {
    const label = newLabel.trim();
    if (!label) return;
    let key = slugKey(label);
    const taken = new Set([...packItems.map((i) => i.key), ...customItems.map((i) => i.key)]);
    for (let n = 2; taken.has(key); n++) key = `${slugKey(label)}_${n}`;
    onChange({ overrides, customItems: [...customItems, { key, label: { en: label, id: label }, required: false, source: 'tenant' }] });
    setNewLabel('');
  };

  const updateCustom = (key: string, patch: Partial<DueDiligenceRequirement>) => {
    onChange({ overrides, customItems: customItems.map((item) => (item.key === key ? { ...item, ...patch } : item)) });
  };

  const removeCustom = (key: string) => {
    onChange({ overrides, customItems: customItems.filter((item) => item.key !== key) });
  };

  const rowClass = 'flex flex-col gap-2 border-b border-hairline py-3 last:border-b-0  sm:flex-row sm:items-center';
  const toggleClass = 'inline-flex min-h-10 items-center gap-2 text-sm text-ink ';

  return (
    <div>
      <ul className="divide-y-0">
        {packOnly.map((item) => {
          const override = overrides[item.key] || {};
          const required = typeof override.required === 'boolean' ? override.required : item.required;
          const hidden = Boolean(override.disabled);
          return (
            <li key={item.key} className={rowClass}>
              <div className="min-w-0 flex-1">
                <span className={`wrap-break-word text-sm font-medium ${hidden ? 'text-ink-soft line-through' : 'text-ink '}`}>
                  {localize(item.label, language)}
                </span>
                <span className="ml-2 rounded-full border border-hairline px-2 py-0.5 text-xs text-ink-soft">
                  {t(SOURCE_KEY[item.source || 'core'] || SOURCE_KEY.core, item.source || 'core')}
                </span>
              </div>
              <label className={`${toggleClass} shrink-0`}>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={required}
                  disabled={disabled || hidden}
                  onChange={(e) => setOverride(item.key, { required: e.target.checked })}
                />
                {t('settings.region.dd_required', 'Required')}
              </label>
              <label className={`${toggleClass} shrink-0`}>
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={hidden}
                  disabled={disabled}
                  onChange={(e) => setOverride(item.key, { disabled: e.target.checked })}
                />
                {t('settings.region.dd_hidden', 'Hidden')}
              </label>
            </li>
          );
        })}
        {customItems.map((item) => (
          <li key={item.key} className={rowClass}>
            <div className="min-w-0 flex-1">
              <span className="wrap-break-word text-sm font-medium text-ink">{localize(item.label, language)}</span>
              <span className="ml-2 rounded-full border border-hairline px-2 py-0.5 text-xs text-ink-soft">
                {t('settings.region.dd_source_tenant', 'Custom')}
              </span>
            </div>
            <label className={`${toggleClass} shrink-0`}>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={item.required}
                disabled={disabled}
                onChange={(e) => updateCustom(item.key, { required: e.target.checked })}
              />
              {t('settings.region.dd_required', 'Required')}
            </label>
            <button
              type="button"
              onClick={() => removeCustom(item.key)}
              disabled={disabled}
              className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-md text-status-danger hover:bg-status-danger-soft dark:hover:bg-status-danger-soft/40"
              aria-label={`${t('settings.region.dd_remove', 'Remove item')}: ${localize(item.label, language)}`}
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={newLabelId} className="mb-1 block text-sm font-medium text-ink">
            {t('settings.region.dd_new_label', 'New item name')}
          </label>
          <input
            id={newLabelId}
            type="text"
            value={newLabel}
            disabled={disabled}
            onChange={(e) => setNewLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            className="ds-input w-full"
          />
        </div>
        <button
          type="button"
          onClick={addCustom}
          disabled={disabled || !newLabel.trim()}
          className="ui-button ui-button-lg disabled:opacity-50 ds-button ds-button-lg ds-button-outline"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('settings.region.dd_add', 'Add checklist item')}
        </button>
      </div>
    </div>
  );
};
