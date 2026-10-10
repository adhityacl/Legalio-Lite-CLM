export type UITextLanguage = 'ID' | 'EN' | 'ZH';
export type UITextOverrides = Record<UITextLanguage, Record<string, string>>;
export interface UITextDictionary { overrides: UITextOverrides }
