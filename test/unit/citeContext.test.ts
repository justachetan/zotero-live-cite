import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findCiteContext, keyTailLength } from '../../src/citeContext';

test('right after \\cite{ the partial key is empty and starts at the cursor', () => {
  const prefix = 'as shown in \\cite{';
  assert.deepEqual(findCiteContext(prefix), { partialKey: '', startCharacter: prefix.length });
});

test('the key after the last comma is the one being typed', () => {
  const prefix = '\\citep{vaswani_attention_2017, he_de';
  assert.deepEqual(findCiteContext(prefix), { partialKey: 'he_de', startCharacter: prefix.length - 5 });
});

test('space after a comma is not part of the key', () => {
  assert.deepEqual(findCiteContext('\\cite{a, '), { partialKey: '', startCharacter: 9 });
});

test('natbib and biblatex variants, starred forms and optional arguments are recognised', () => {
  for (const prefix of [
    '\\citet{wa',
    '\\citeauthor{wa',
    '\\nocite{wa',
    '\\textcite{wa',
    '\\parencite*{wa',
    '\\Citep{wa',
    '\\Textcite{wa',
    '\\citep[see][p.~3]{wa',
    '\\citep[e.g.,][]{wa',
    '\\cite {wa',
  ]) {
    assert.equal(findCiteContext(prefix)?.partialKey, 'wa', prefix);
  }
});

test('outside a citation key list there is no context', () => {
  for (const prefix of [
    'plain text wa',
    '\\section{wa',
    '\\cite{vaswani_attention_2017} and wa',
    '\\cite{a}{wa',
    '\\cite',
    '\\citep[see',
  ]) {
    assert.equal(findCiteContext(prefix), undefined, prefix);
  }
});

test('a citation inside a comment is ignored, but an escaped percent is not a comment', () => {
  assert.equal(findCiteContext('% TODO \\cite{wa'), undefined);
  assert.equal(findCiteContext('text % \\cite{wa'), undefined);
  assert.equal(findCiteContext('50\\% of \\cite{wa')?.partialKey, 'wa');
});

test('keyTailLength stops at the end of the key under the cursor', () => {
  assert.equal(keyTailLength('ng_2025}, more'), 7);
  assert.equal(keyTailLength('ng_2025, other}'), 7);
  assert.equal(keyTailLength('ng_2025 }'), 7);
  assert.equal(keyTailLength('}'), 0);
  assert.equal(keyTailLength('ng_2025'), 7);
  assert.equal(keyTailLength(''), 0);
});
