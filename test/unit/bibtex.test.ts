import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bibHasKey, citeKeyOf, entryInsertion } from '../../src/bibtex';

// Shape of an entry as Zotero's BibTeX export produces it (leading newline,
// tab-indented fields).
const ZOTERO_ENTRY = '\n@misc{vaswani_attention_2017,\n\ttitle = {Attention {Is} {All} {You} {Need}},\n\tyear = {2017},\n}\n';

test('citeKeyOf reads the key from a Zotero export', () => {
  assert.equal(citeKeyOf(ZOTERO_ENTRY), 'vaswani_attention_2017');
  assert.equal(citeKeyOf('@inproceedings{ vaswani_attention_2017 ,\n}'), 'vaswani_attention_2017');
  assert.equal(citeKeyOf(''), undefined);
});

test('bibHasKey matches whole keys only, case-insensitively', () => {
  const bib = '@misc{vaswani_attention_2017,\n}\n\n@Article{He_deep_2016,\n}\n';
  assert.equal(bibHasKey(bib, 'vaswani_attention_2017'), true);
  assert.equal(bibHasKey(bib, 'he_deep_2016'), true);
  assert.equal(bibHasKey(bib, 'vaswani'), false);
  assert.equal(bibHasKey(bib, 'attention_2017'), false);
  // A key mentioned in another entry's field is not a definition.
  assert.equal(bibHasKey('@misc{a,\n\tnote = {see smith_x_2025, too},\n}', 'smith_x_2025'), false);
});

test('bibHasKey treats regex characters in keys literally', () => {
  assert.equal(bibHasKey('@misc{a.b+c,\n}', 'a.b+c'), true);
  assert.equal(bibHasKey('@misc{aXbbc,\n}', 'a.b+c'), false);
});

test('appending keeps one blank line between entries whatever the file ending', () => {
  const entry = '@misc{vaswani_attention_2017,\n\ttitle = {Attention {Is} {All} {You} {Need}},\n\tyear = {2017},\n}\n';
  // File without a final newline.
  assert.equal(entryInsertion('@misc{a,\n}', ZOTERO_ENTRY), `\n\n${entry}`);
  // File with a final newline.
  assert.equal(entryInsertion('@misc{a,\n}\n', ZOTERO_ENTRY), `\n${entry}`);
  // Empty or whitespace-only file: the entry goes first.
  assert.equal(entryInsertion('', ZOTERO_ENTRY), entry);
  assert.equal(entryInsertion('\n\n', ZOTERO_ENTRY), entry);
});
