import assert from 'node:assert/strict';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import {
  CollectionNotFoundError,
  MAX_RESULTS,
  ZoteroClient,
  ZoteroUnavailableError,
  findCollection,
  rankByKeyPrefix,
  searchTermsFor,
  type ZoteroCollection,
} from '../../src/zoteroClient';
import { SAMPLE_LIBRARY, startFakeZotero, type FakeZotero } from '../fakeZotero';

let zotero: FakeZotero;

before(async () => {
  // Page size 3 forces the four sample collections onto two pages.
  zotero = await startFakeZotero({ ...SAMPLE_LIBRARY, collectionPageSize: 3 });
});

after(() => zotero.close());

test('searchTermsFor turns a Zotero-style key prefix into search words', () => {
  assert.equal(searchTermsFor('shaw_self-attention_20'), 'shaw self-attention 20');
  assert.equal(searchTermsFor('noauthor_handbook_nodate'), 'handbook');
  assert.equal(searchTermsFor('vaswani_'), 'vaswani');
  assert.equal(searchTermsFor(''), '');
});

test('a library search returns citable items with keys from the BibTeX export', async () => {
  const items = await new ZoteroClient(zotero.libraryUrl).search('vaswani_attention', '');
  // Zotero returns Shaw et al. (co-authored by Vaswani) first; the key that
  // starts with what was typed is ranked above it, and the duplicate item is
  // dropped.
  assert.deepEqual(items.map((i) => i.citeKey), ['vaswani_attention_2017', 'shaw_self-attention_2018']);
  const [vaswani] = items;
  assert.equal(vaswani.creators, 'Vaswani and Shazeer', 'bidi isolates are stripped from the creator summary');
  assert.equal(vaswani.year, '2017');
  assert.equal(vaswani.venue, 'Advances in Neural Information Processing Systems');
  assert.match(vaswani.bibtex, /^\s*@misc\{vaswani_attention_2017,/);

  const request = zotero.requests.at(-1)!;
  assert.equal(request.pathname, '/api/users/0/items/top');
  assert.equal(request.searchParams.get('q'), 'vaswani attention');
  assert.equal(request.searchParams.get('include'), 'data,bibtex');
});

test('the best key match is found even when Zotero lists many weaker matches first', async () => {
  // 30 attention papers co-authored by a Vaswani, all listed before the one
  // whose key starts with "vaswani_attention": more than a screenful.
  const fillers = Array.from({ length: 30 }, (_, i) => ({
    key: `FILL${String(i).padStart(4, '0')}`,
    itemType: 'journalArticle',
    title: `Attention Benchmark ${i}`,
    lastNames: ['Smith', 'Vaswani', 'Lee'],
    year: '2024',
    collections: [],
    citeKey: `smith_attention_2024${'abcdefghijklmnopqrstuvwxyzABCD'[i]}`,
  }));
  const target = SAMPLE_LIBRARY.items.find((i) => i.citeKey === 'vaswani_attention_2017')!;
  const crowded = await startFakeZotero({ collections: [], items: [...fillers, target] });
  try {
    const items = await new ZoteroClient(crowded.libraryUrl).search('vaswani_attention', '');
    assert.equal(items[0]?.citeKey, 'vaswani_attention_2017');
    assert.equal(items.length, MAX_RESULTS);
  } finally {
    await crowded.close();
  }
});

test('rankByKeyPrefix orders key-prefix matches, then keys containing every word, then the rest', () => {
  const item = (citeKey: string) => ({ citeKey, bibtex: '', title: '', creators: '', year: '', venue: '' });
  const ranked = rankByKeyPrefix(
    [
      item('shaw_self-attention_2018'),
      item('bahdanau_neural_2015'),
      item('lee_vaswani_attention_2020'),
      item('vaswani_attention_2017'),
    ],
    'Vaswani_Attention',
  );
  assert.deepEqual(ranked.map((i) => i.citeKey), [
    'vaswani_attention_2017',
    'lee_vaswani_attention_2020',
    'shaw_self-attention_2018',
    'bahdanau_neural_2015',
  ]);
  // Without a prefix Zotero's order (most recently modified first) is kept.
  assert.deepEqual(rankByKeyPrefix([item('b'), item('a')], '').map((i) => i.citeKey), ['b', 'a']);
});

test('an empty prefix lists items without a query, and notes are dropped', async () => {
  const items = await new ZoteroClient(zotero.libraryUrl).search('', '');
  assert.deepEqual(items.map((i) => i.citeKey).sort(), [
    'devlin_bert_2019',
    'he_deep_2016',
    'shaw_self-attention_2018',
    'vaswani_attention_2017',
  ]);
  assert.equal(zotero.requests.at(-1)!.searchParams.has('q'), false);
});

test('a collection search covers subcollections and lists each item once', async () => {
  const client = new ZoteroClient(zotero.libraryUrl);
  const items = await client.search('', 'Thesis');
  assert.deepEqual(items.map((i) => i.citeKey).sort(), [
    'devlin_bert_2019',
    'shaw_self-attention_2018',
    'vaswani_attention_2017',
  ]);

  const itemRequests = zotero.requests.filter((r) => r.pathname.endsWith('/items/top')).slice(-2);
  assert.deepEqual(itemRequests.map((r) => r.pathname).sort(), [
    '/api/users/0/collections/DRAFTS01/items/top',
    '/api/users/0/collections/THESIS01/items/top',
  ]);
});

test('the collection tree is fetched across pages and then cached', async () => {
  const client = new ZoteroClient(zotero.libraryUrl);
  const before = zotero.requests.length;
  const collections = await client.listCollections();
  assert.deepEqual(collections.map((c) => c.path).sort(), ['Reading List', 'Reading List/Drafts', 'Thesis', 'Thesis/Drafts']);
  const collectionRequests = zotero.requests.slice(before).filter((r) => r.pathname.endsWith('/collections'));
  assert.equal(collectionRequests.length, 2);

  await client.search('', 'Reading List');
  assert.equal(zotero.requests.slice(before).filter((r) => r.pathname.endsWith('/collections')).length, 2);
});

test('findCollection accepts a key, a path or a unique name', () => {
  const collections: ZoteroCollection[] = [
    { key: 'AAAA1111', name: 'Thesis', parentKey: undefined, path: 'Thesis' },
    { key: 'BBBB2222', name: 'Drafts', parentKey: 'AAAA1111', path: 'Thesis/Drafts' },
    { key: 'CCCC3333', name: 'Reading', parentKey: undefined, path: 'Reading' },
    { key: 'DDDD4444', name: 'Drafts', parentKey: 'CCCC3333', path: 'Reading/Drafts' },
  ];
  assert.equal(findCollection(collections, 'BBBB2222').path, 'Thesis/Drafts');
  assert.equal(findCollection(collections, 'thesis').key, 'AAAA1111');
  assert.equal(findCollection(collections, 'Reading/Drafts').key, 'DDDD4444');
  assert.throws(() => findCollection(collections, 'Drafts'), (error: Error) =>
    error instanceof CollectionNotFoundError && error.message.includes('"Thesis/Drafts"') && error.message.includes('"Reading/Drafts"'));
  assert.throws(() => findCollection(collections, 'Missing'), CollectionNotFoundError);
});

test('an unknown collection is reported, not silently widened to the library', async () => {
  await assert.rejects(new ZoteroClient(zotero.libraryUrl).search('vaswani', 'Nope'), CollectionNotFoundError);
});

test('a disabled local API explains which Zotero setting to turn on', async () => {
  const disabled = await startFakeZotero({ ...SAMPLE_LIBRARY, localApiEnabled: false });
  try {
    await assert.rejects(new ZoteroClient(disabled.libraryUrl).search('vaswani', ''), (error: Error) =>
      error instanceof ZoteroUnavailableError && error.message.includes('Allow other applications'));
  } finally {
    await disabled.close();
  }
});

test('Zotero not running is reported as unavailable', async () => {
  // Bind and release a port so nothing is listening on it.
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  await new Promise((resolve) => server.close(resolve));

  await assert.rejects(new ZoteroClient(`http://127.0.0.1:${port}/api/users/0`).search('vaswani', ''), (error: Error) =>
    error instanceof ZoteroUnavailableError && error.message.includes('Is the Zotero app running?'));
});

test('an aborted search rejects with the abort, not as Zotero being unavailable', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(new ZoteroClient(zotero.libraryUrl).search('vaswani', '', controller.signal), (error: Error) =>
    error.name === 'AbortError');
});
