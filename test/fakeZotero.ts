/**
 * A real HTTP server that imitates the slice of Zotero's local API the
 * extension uses, so tests exercise actual requests, URLs, headers and JSON
 * without a running Zotero.
 *
 * Response shapes copy what Zotero 10's local API returned when this was
 * written: items carry `data`, `meta` and (with `include=bibtex`) a `bibtex`
 * string; collection lists are paginated with a `Total-Results` header; a
 * disabled local API answers 403 "Local API is not enabled".
 *
 * Used by the unit tests and by the VS Code integration test.
 */

import * as http from 'node:http';
import type { AddressInfo } from 'node:net';

/** An item in the fake library. */
export interface FakeItem {
  readonly key: string;
  readonly itemType: string;
  readonly title: string;
  readonly lastNames: readonly string[];
  readonly year: string;
  /** Keys of the collections that directly contain the item. */
  readonly collections: readonly string[];
  /** Key used in the BibTeX export; `undefined` exports no entry (like notes). */
  readonly citeKey: string | undefined;
  readonly publicationTitle?: string;
  /** Full BibTeX export to serve; generated from the fields when omitted. */
  readonly bibtex?: string;
}

/** A collection in the fake library. */
export interface FakeCollection {
  readonly key: string;
  readonly name: string;
  readonly parentCollection: string | false;
}

/** Configuration of one fake server. */
export interface FakeLibrary {
  readonly items: readonly FakeItem[];
  readonly collections: readonly FakeCollection[];
  /** Mimics the "Allow other applications..." checkbox; default true. */
  readonly localApiEnabled?: boolean;
  /** Largest page served for collection lists, to exercise pagination. */
  readonly collectionPageSize?: number;
}

/** A running fake server. */
export interface FakeZotero {
  /** Library URL to pass to `ZoteroClient`, e.g. `http://127.0.0.1:5123/api/users/0`. */
  readonly libraryUrl: string;
  /** Every request URL received, in order. */
  readonly requests: URL[];
  close(): Promise<void>;
}

/** A small library of well-known papers shared by the unit and integration tests. */
export const SAMPLE_LIBRARY: FakeLibrary = {
  collections: [
    { key: 'THESIS01', name: 'Thesis', parentCollection: false },
    { key: 'DRAFTS01', name: 'Drafts', parentCollection: 'THESIS01' },
    { key: 'READING1', name: 'Reading List', parentCollection: false },
    { key: 'READDRF1', name: 'Drafts', parentCollection: 'READING1' },
  ],
  items: [
    {
      // Matches "vaswani attention" through a co-author, and Zotero lists it
      // first: ranking must still put the key that starts with
      // "vaswani_attention" on top.
      key: 'ITEMSHAW',
      itemType: 'conferencePaper',
      title: 'Self-Attention with Relative Position Representations',
      lastNames: ['Shaw', 'Uszkoreit', 'Vaswani'],
      year: '2018',
      collections: ['THESIS01'],
      citeKey: 'shaw_self-attention_2018',
    },
    {
      key: 'ITEMVASW',
      itemType: 'conferencePaper',
      title: 'Attention Is All You Need',
      lastNames: ['Vaswani', 'Shazeer'],
      year: '2017',
      collections: ['THESIS01'],
      citeKey: 'vaswani_attention_2017',
      publicationTitle: 'Advances in Neural Information Processing Systems',
    },
    {
      // A duplicate Zotero item of the same paper: same exported key, so it
      // must be offered only once.
      key: 'ITEMVAS2',
      itemType: 'conferencePaper',
      title: 'Attention Is All You Need',
      lastNames: ['Vaswani', 'Shazeer'],
      year: '2017',
      collections: ['READING1'],
      citeKey: 'vaswani_attention_2017',
      publicationTitle: 'Advances in Neural Information Processing Systems',
    },
    {
      key: 'ITEMHEXX',
      itemType: 'conferencePaper',
      title: 'Deep Residual Learning for Image Recognition',
      lastNames: ['He', 'Zhang', 'Ren', 'Sun'],
      year: '2016',
      collections: ['READING1'],
      citeKey: 'he_deep_2016',
    },
    {
      key: 'ITEMDEVL',
      itemType: 'conferencePaper',
      title: 'BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding',
      lastNames: ['Devlin', 'Chang', 'Lee', 'Toutanova'],
      year: '2019',
      // In both a subcollection and its parent, to exercise deduplication.
      collections: ['DRAFTS01', 'THESIS01'],
      citeKey: 'devlin_bert_2019',
    },
    {
      key: 'ITEMNOTE',
      itemType: 'note',
      title: '',
      lastNames: [],
      year: '',
      collections: ['THESIS01'],
      citeKey: undefined,
    },
  ],
};

/**
 * Starts a fake Zotero local API on an ephemeral localhost port.
 *
 * @param library Items and collections to serve.
 * @returns The running server; call `close()` when done.
 */
export async function startFakeZotero(library: FakeLibrary): Promise<FakeZotero> {
  const requests: URL[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    requests.push(url);
    const reply = route(library, url);
    response.writeHead(reply.status, { 'Content-Type': reply.contentType, ...reply.headers });
    response.end(reply.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    libraryUrl: `http://127.0.0.1:${port}/api/users/0`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

/** An HTTP response to send. */
interface Reply {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  readonly headers?: Record<string, string>;
}

/**
 * Answers one request the way Zotero's local API would.
 *
 * @param library Served data.
 * @param url Request URL.
 */
function route(library: FakeLibrary, url: URL): Reply {
  if (library.localApiEnabled === false) {
    return { status: 403, contentType: 'text/plain', body: 'Local API is not enabled' };
  }
  const path = url.pathname.replace(/^\/api\/users\/0\//, '');

  if (path === 'collections') {
    const start = Number(url.searchParams.get('start') ?? 0);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? 25), library.collectionPageSize ?? 100);
    const page = library.collections.slice(start, start + limit).map((c) => ({
      key: c.key,
      data: { key: c.key, name: c.name, parentCollection: c.parentCollection },
    }));
    return json(page, { 'Total-Results': String(library.collections.length) });
  }

  const itemsPath = /^(?:collections\/([A-Z0-9]+)\/)?items\/top$/.exec(path);
  if (itemsPath) {
    const collectionKey = itemsPath[1];
    const words = (url.searchParams.get('q') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const includeBibtex = (url.searchParams.get('include') ?? '').split(',').includes('bibtex');
    const limit = Number(url.searchParams.get('limit') ?? 25);
    const matches = library.items
      .filter((item) => !collectionKey || item.collections.includes(collectionKey))
      .filter((item) => words.every((word) => searchableText(item).includes(word)))
      .slice(0, limit)
      .map((item) => toApiItem(item, includeBibtex));
    return json(matches);
  }

  return { status: 404, contentType: 'text/plain', body: 'No endpoint found' };
}

/**
 * Text Zotero's "Title, Creator, Year" quick search looks at, lower-cased.
 *
 * @param item Library item.
 */
function searchableText(item: FakeItem): string {
  return [item.title, ...item.lastNames, item.year].join(' ').toLowerCase();
}

/**
 * Shapes an item like the local API's JSON.
 *
 * @param item Library item.
 * @param includeBibtex Whether the request asked for `include=bibtex`.
 */
function toApiItem(item: FakeItem, includeBibtex: boolean): object {
  // Zotero wraps the two names of a two-author summary in Unicode bidi
  // isolates (U+2068 … U+2069), e.g. "⁨Coumans⁩ and ⁨Bai⁩".
  const creatorSummary =
    item.lastNames.length > 2 ? `${item.lastNames[0]} et al.`
    : item.lastNames.length === 2 ? `⁨${item.lastNames[0]}⁩ and ⁨${item.lastNames[1]}⁩`
    : (item.lastNames[0] ?? '');
  const bibtex =
    item.bibtex ??
    (item.citeKey
      ? `\n@misc{${item.citeKey},\n\ttitle = {${item.title}},\n\tauthor = {${item.lastNames.join(' and ')}},\n\tyear = {${item.year}},\n}\n`
      : '');
  return {
    key: item.key,
    meta: { creatorSummary, parsedDate: item.year ? `${item.year}-01-01` : undefined },
    data: {
      key: item.key,
      itemType: item.itemType,
      title: item.title,
      publicationTitle: item.publicationTitle,
      collections: item.collections,
    },
    ...(includeBibtex ? { bibtex } : {}),
  };
}

/**
 * Builds a JSON reply.
 *
 * @param body Value to serialize.
 * @param headers Extra response headers.
 */
function json(body: unknown, headers: Record<string, string> = {}): Reply {
  return { status: 200, contentType: 'application/json', body: JSON.stringify(body), headers };
}
