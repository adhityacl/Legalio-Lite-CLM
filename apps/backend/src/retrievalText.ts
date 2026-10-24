/**
 * The searchable text of every record type the AI chat retrieves from, as SQL expressions. The migration builds the GIN full-text
 * indexes from exactly these expressions and the retrieval queries repeat them, which is what lets PostgreSQL use the indexes.
 * Kept free of imports so the migration bundle stays small.
 */
export const RETRIEVAL_TEXT = {
  search_records: `(coalesce(title, '') || ' ' || coalesce(body, ''))`,
  obligations: `(coalesce(title, '') || ' ' || coalesce(description, ''))`,
  clauses: `(coalesce(title, '') || ' ' || coalesce(category, '') || ' ' || coalesce(guidance, '') || ' ' || coalesce(approved_text, '') || ' ' || coalesce(tags, ''))`,
  contract_key_terms: `(coalesce(label, '') || ' ' || coalesce(value, '') || ' ' || coalesce(summary, ''))`,
  /** Editor documents are HTML: tags are stripped and the text is bounded (a tsvector cannot exceed 1 MB). */
  contract_documents: `(coalesce(name, '') || ' ' || regexp_replace(left(coalesce(content, ''), 200000), '<[^>]*>', ' ', 'g'))`,
} as const;
export type RetrievalTable = keyof typeof RETRIEVAL_TEXT;

/** Full-text configuration: `simple` (no stemming, no stop words) works the same for English, Indonesian and names. */
export const RETRIEVAL_CONFIG = 'simple';
