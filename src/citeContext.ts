/**
 * Detects whether the cursor sits inside the key list of a LaTeX citation
 * command, and which partial key is being typed there.
 *
 * Pure string logic with no VS Code dependency, so it is unit-tested directly.
 * Used by the completion provider (`completion.ts`) on every completion request.
 */

/**
 * Matches a citation command whose key list is still open at the end of the
 * line prefix: any command containing "cite" (`\cite`, `\citep`, `\textcite`,
 * `\nocite`, ...) including the capitalized sentence-start forms (`\Citep`,
 * `\Textcite`), an optional star, up to two `[...]` optional arguments, and
 * an opening `{` followed by keys and commas but no closing brace yet.
 * Group 1 is everything typed inside the braces so far.
 */
const OPEN_CITE_COMMAND = /\\[a-zA-Z]*[cC]ite[a-zA-Z]*\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^{}]*)$/;

/** Characters that end a citation key inside `\cite{...}`. */
const KEY_TERMINATOR = /[\s,}]/;

/** Where the key under the cursor starts, and what has been typed of it. */
export interface CiteContext {
  /** Text typed so far for the key under the cursor, e.g. `"vaswani_at"`. */
  readonly partialKey: string;
  /** Zero-based column where that key starts on the line. */
  readonly startCharacter: number;
}

/**
 * Finds the citation key being typed at the end of `linePrefix`.
 *
 * @param linePrefix The current line's text from column 0 up to the cursor.
 * @returns The partial key and its start column when the cursor is inside an
 *   unclosed citation key list that is not commented out; otherwise `undefined`.
 *   After `\cite{a, wa` the partial key is `"wa"`; directly after `\cite{` or
 *   a comma it is `""`.
 */
export function findCiteContext(linePrefix: string): CiteContext | undefined {
  const match = OPEN_CITE_COMMAND.exec(linePrefix);
  if (!match || isCommentedOut(linePrefix.slice(0, match.index))) {
    return undefined;
  }
  const keyList = match[1];
  // Only the key after the last comma is being edited; earlier keys are done.
  const partialKey = keyList.slice(keyList.lastIndexOf(',') + 1).trimStart();
  return { partialKey, startCharacter: linePrefix.length - partialKey.length };
}

/**
 * Measures the rest of the key under the cursor, so accepting a completion in
 * the middle of an existing key replaces the whole key rather than splicing.
 *
 * @param lineSuffix The current line's text from the cursor to the line end.
 * @returns Number of characters before the next whitespace, comma or `}`.
 */
export function keyTailLength(lineSuffix: string): number {
  const end = lineSuffix.search(KEY_TERMINATOR);
  return end === -1 ? lineSuffix.length : end;
}

/**
 * Reports whether a line prefix contains an unescaped `%`, which makes the
 * rest of the line a LaTeX comment.
 *
 * @param text Line text before the citation command.
 */
function isCommentedOut(text: string): boolean {
  return /(^|[^\\])%/.test(text);
}
