/**
 * Small, pure helpers for reading and appending BibTeX entries.
 *
 * Used by `bibWriter.ts` to decide whether a chosen reference is already in the
 * target `.bib` file and how to append it, and by `zoteroClient.ts` to read the
 * citation key out of the entry Zotero exports.
 */

/** Matches the start of an entry, e.g. `@misc{vaswani_attention_2017,`. */
const ENTRY_HEAD = /@[a-zA-Z]+\s*\{\s*([^\s,{}]+)\s*,/;

/**
 * Extracts the citation key from a single BibTeX entry.
 *
 * @param entry BibTeX text whose first entry head names the key.
 * @returns The key (e.g. `"vaswani_attention_2017"`), or `undefined` if the
 *   text has no entry head (Zotero exports nothing useful for notes).
 */
export function citeKeyOf(entry: string): string | undefined {
  return ENTRY_HEAD.exec(entry)?.[1];
}

/**
 * Checks whether a `.bib` file already defines an entry with this key.
 *
 * BibTeX treats keys case-insensitively when it detects repeated entries, so
 * the check does too. Only whole keys match: `vaswani` does not match
 * `vaswani_attention_2017`.
 *
 * @param bibText Full contents of the `.bib` file.
 * @param citeKey Key to look for.
 */
export function bibHasKey(bibText: string, citeKey: string): boolean {
  const head = new RegExp(`@[a-zA-Z]+\\s*\\{\\s*${escapeRegExp(citeKey)}\\s*,`, 'i');
  return head.test(bibText);
}

/**
 * Builds the text to insert at the very end of a `.bib` file to append one
 * entry, keeping exactly one blank line between entries.
 *
 * @param bibText Current contents of the `.bib` file (may lack a final newline).
 * @param entry BibTeX entry as exported by Zotero (leading/trailing whitespace
 *   is ignored).
 * @returns Text to insert at the end of the file; it always ends in a newline.
 */
export function entryInsertion(bibText: string, entry: string): string {
  const body = `${entry.trim()}\n`;
  if (bibText.trim() === '') {
    return body;
  }
  return (bibText.endsWith('\n') ? '\n' : '\n\n') + body;
}

/**
 * Escapes a string for literal use inside a regular expression.
 *
 * @param text Arbitrary text, such as a citation key with `.` or `+`.
 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
