/**
 * Client for the Zotero desktop app's local API (Zotero 7+, enabled under
 * Settings → Advanced → "Allow other applications on this computer to
 * communicate with Zotero"). The API mirrors Zotero's web API at
 * `http://127.0.0.1:23119/api/users/0/...`.
 *
 * One search request per scope returns each item's metadata *and* its BibTeX
 * export (`include=data,bibtex`), so the citation key shown in the completion
 * list is exactly the key Zotero's own BibTeX export produces, and accepting a
 * completion needs no second request.
 *
 * No VS Code dependency: the completion provider and the collection picker use
 * it, and it is tested against a fake HTTP server.
 */

import { citeKeyOf } from './bibtex';

/** Default local API URL of the user's personal library. */
export const DEFAULT_LIBRARY_URL = 'http://127.0.0.1:23119/api/users/0';

/** Most completion results returned for one keystroke. */
export const MAX_RESULTS = 20;

/**
 * Largest page the Zotero API serves per request. Searches fetch a full page
 * and rank it locally: Zotero's quick search matches any co-author and sorts
 * by date, so the best key match is often not among its first results.
 * A 100-item page with BibTeX takes about 0.1 s from a local library.
 */
const API_PAGE_LIMIT = 100;

/** Unicode bidi isolates Zotero puts around names in creator summaries. */
const BIDI_ISOLATES = /[⁦-⁩]/g;

/** How long the collection tree is reused before it is fetched again. */
const COLLECTION_CACHE_MS = 60_000;

/** Placeholder words Zotero puts in keys that never match item metadata. */
const KEY_PLACEHOLDERS = new Set(['noauthor', 'nodate']);

/** Item types that have no bibliography entry. */
const NON_CITABLE_TYPES = new Set(['attachment', 'note', 'annotation']);

/** A citable Zotero item, ready to show as a completion. */
export interface ZoteroItem {
  /** Citation key from Zotero's BibTeX export, e.g. `vaswani_attention_2017`. */
  readonly citeKey: string;
  /** The full BibTeX entry Zotero exported for this item. */
  readonly bibtex: string;
  readonly title: string;
  /** Zotero's short creator summary, e.g. `Vaswani et al.`. */
  readonly creators: string;
  /** Four-digit year, or `""` when the item has no date. */
  readonly year: string;
  /** Journal, proceedings or repository name, or `""`. */
  readonly venue: string;
}

/** A collection in the library, with its slash-separated path. */
export interface ZoteroCollection {
  readonly key: string;
  readonly name: string;
  /** Key of the parent collection; `undefined` for top-level collections. */
  readonly parentKey: string | undefined;
  /** Names from the top level down, e.g. `Reading List/Transformers`. */
  readonly path: string;
}

/**
 * Zotero cannot be reached, or its local API is switched off. The message is
 * written for the user and says how to fix it.
 */
export class ZoteroUnavailableError extends Error {}

/** The configured collection does not identify exactly one collection. */
export class CollectionNotFoundError extends Error {}

/** The subset of a local API item response this client reads. */
interface ApiItem {
  readonly meta?: { readonly creatorSummary?: string; readonly parsedDate?: string };
  readonly data: {
    readonly itemType: string;
    readonly title?: string;
    readonly publicationTitle?: string;
    readonly proceedingsTitle?: string;
    readonly repository?: string;
  };
  readonly bibtex?: string;
}

/** The subset of a local API collection response this client reads. */
interface ApiCollection {
  readonly key: string;
  readonly data: { readonly name: string; readonly parentCollection: string | false };
}

/**
 * Searches one Zotero library over the local API.
 *
 * Instances are cheap; the extension keeps one per library URL so that the
 * collection tree cache is shared between keystrokes.
 */
export class ZoteroClient {
  private collectionCache: { readonly fetchedAt: number; readonly collections: Promise<ZoteroCollection[]> } | undefined;

  /**
   * @param libraryUrl Local API URL of the library, e.g.
   *   `http://127.0.0.1:23119/api/users/0` or `.../api/groups/<id>`.
   */
  constructor(private readonly libraryUrl: string) {}

  /**
   * Finds citable items matching what has been typed of a citation key.
   *
   * Zotero's quick search matches title, creators and year, so the key prefix
   * is turned into search words first (see `searchTermsFor`). Up to a full
   * API page of matches per collection is fetched, ranked by how well each
   * key matches what was typed (`rankByKeyPrefix`), and cut to `MAX_RESULTS`.
   * An empty prefix returns the most recently modified items in scope.
   *
   * @param keyPrefix Partial citation key typed by the user.
   * @param collection Collection name, path or key to search with its
   *   subcollections; `""` searches the whole library.
   * @param signal Aborts the HTTP requests when VS Code cancels the request.
   * @returns Up to `MAX_RESULTS` items with distinct citation keys. Items that
   *   export the same key (an item in two collections, or duplicate items of
   *   one paper) are offered once.
   * @throws ZoteroUnavailableError when Zotero or its local API is unreachable.
   * @throws CollectionNotFoundError when `collection` matches no collection or
   *   several.
   */
  async search(keyPrefix: string, collection: string, signal?: AbortSignal): Promise<ZoteroItem[]> {
    const query = new URLSearchParams({
      include: 'data,bibtex',
      limit: String(API_PAGE_LIMIT),
      sort: 'dateModified',
      direction: 'desc',
    });
    const terms = searchTermsFor(keyPrefix);
    if (terms) {
      query.set('q', terms);
    }

    // The API does not search subcollections, so a collection scope becomes
    // one request per collection in its subtree, issued in parallel.
    const paths = collection
      ? (await this.collectionSubtree(collection)).map((key) => `collections/${key}/items/top`)
      : ['items/top'];
    const pages = await Promise.all(paths.map((path) => this.getJson<ApiItem[]>(`${path}?${query}`, signal)));
    const candidates = pages.flatMap((page) => page.body.map(toZoteroItem)).filter((item) => item !== undefined);

    // Rank first so that, among items sharing a key, the best-placed one wins.
    const seenKeys = new Set<string>();
    const items: ZoteroItem[] = [];
    for (const item of rankByKeyPrefix(candidates, keyPrefix)) {
      if (!seenKeys.has(item.citeKey)) {
        seenKeys.add(item.citeKey);
        items.push(item);
      }
    }
    return items.slice(0, MAX_RESULTS);
  }

  /**
   * Lists every collection in the library with its full path. The result is
   * cached for `COLLECTION_CACHE_MS` so collection-scoped searches do not
   * refetch the tree on every keystroke. The fetch is shared by concurrent
   * callers, so it takes no abort signal: one cancelled keystroke must not
   * fail the others.
   *
   * @throws ZoteroUnavailableError when Zotero or its local API is unreachable.
   */
  listCollections(): Promise<ZoteroCollection[]> {
    const now = Date.now();
    if (!this.collectionCache || now - this.collectionCache.fetchedAt > COLLECTION_CACHE_MS) {
      const collections = this.fetchCollections();
      this.collectionCache = { fetchedAt: now, collections };
      // A failed fetch must not stay cached.
      collections.catch(() => {
        if (this.collectionCache?.collections === collections) {
          this.collectionCache = undefined;
        }
      });
    }
    return this.collectionCache.collections;
  }

  /**
   * Fetches all collections, following the API's pagination.
   */
  private async fetchCollections(): Promise<ZoteroCollection[]> {
    const raw: ApiCollection[] = [];
    let total = Infinity;
    while (raw.length < total) {
      const page = await this.getJson<ApiCollection[]>(
        `collections?format=json&limit=${API_PAGE_LIMIT}&start=${raw.length}`,
      );
      raw.push(...page.body);
      total = Number(page.headers.get('Total-Results') ?? raw.length);
      if (page.body.length === 0) {
        break;
      }
    }
    return withPaths(raw);
  }

  /**
   * Resolves a collection reference to the keys of that collection and all of
   * its descendants (parent first).
   *
   * @param collection Collection name, path or key.
   */
  private async collectionSubtree(collection: string): Promise<string[]> {
    const all = await this.listCollections();
    const root = findCollection(all, collection);
    const keys = [root.key];
    // Breadth-first walk; `keys` grows while it is iterated.
    for (const key of keys) {
      keys.push(...all.filter((c) => c.parentKey === key).map((c) => c.key));
    }
    return keys;
  }

  /**
   * GETs a JSON resource under the library URL, translating connection and
   * "local API disabled" failures into `ZoteroUnavailableError`.
   *
   * @param path Path and query relative to the library URL.
   * @param signal Aborts the request; an abort is rethrown unchanged.
   */
  private async getJson<T>(path: string, signal?: AbortSignal): Promise<{ body: T; headers: Headers }> {
    const url = `${this.libraryUrl.replace(/\/+$/, '')}/${path}`;
    let response: Response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (signal?.aborted) {
        throw error;
      }
      throw new ZoteroUnavailableError(`Can't reach Zotero at ${this.libraryUrl}. Is the Zotero app running?`);
    }
    if (!response.ok) {
      const text = await response.text();
      if (response.status === 403 && /local api is not enabled/i.test(text)) {
        throw new ZoteroUnavailableError(
          'Zotero\'s local API is off. In Zotero, open Settings → Advanced and tick "Allow other applications on this computer to communicate with Zotero".',
        );
      }
      throw new Error(`Zotero returned ${response.status} for ${url}: ${text.trim()}`);
    }
    return { body: (await response.json()) as T, headers: response.headers };
  }
}

/**
 * Turns a partial citation key into Zotero quick-search words.
 *
 * Zotero's BibTeX keys look like `lastname_firstword_year`, while quick search
 * matches whole-field substrings, so `vaswani_att` must become `vaswani att`.
 * Placeholder words (`noauthor`, `nodate`) are dropped because no field
 * contains them.
 *
 * @param keyPrefix Partial key as typed, e.g. `"vaswani_attention_20"`.
 * @returns Space-separated search words, e.g. `"vaswani attention 20"`, or
 *   `""` when nothing searchable was typed.
 */
export function searchTermsFor(keyPrefix: string): string {
  return keyPrefix
    .split(/[\s_]+/)
    .filter((word) => word && !KEY_PLACEHOLDERS.has(word.toLowerCase()))
    .join(' ');
}

/**
 * Orders search results by how well their citation keys match the typed
 * prefix, keeping Zotero's order (most recently modified first) within each
 * tier:
 *
 *   0. the key starts with the prefix (`vaswani_att` → `vaswani_attention_2017`)
 *   1. the key contains every typed word (`need` → `vaswani_attention_2017`)
 *   2. everything else Zotero matched (e.g. through a co-author or the title)
 *
 * @param items Search results in Zotero's order.
 * @param keyPrefix Partial key as typed; matching ignores case.
 * @returns A new, stably sorted array.
 */
export function rankByKeyPrefix(items: readonly ZoteroItem[], keyPrefix: string): ZoteroItem[] {
  const prefix = keyPrefix.trim().toLowerCase();
  if (!prefix) {
    return [...items];
  }
  const words = prefix.split(/[\s_]+/).filter(Boolean);
  const tier = (item: ZoteroItem): number => {
    const key = item.citeKey.toLowerCase();
    if (key.startsWith(prefix)) {
      return 0;
    }
    return words.every((word) => key.includes(word)) ? 1 : 2;
  };
  // Array.prototype.sort is stable, so equal tiers keep Zotero's order.
  return [...items].sort((a, b) => tier(a) - tier(b));
}

/**
 * Picks the one collection a reference names. A collection key matches
 * exactly; a path or plain name matches case-insensitively, and a plain name
 * must be unique.
 *
 * @param collections All collections in the library.
 * @param reference Collection key, path (`A/B`) or name.
 * @throws CollectionNotFoundError when nothing matches or a name is ambiguous.
 */
export function findCollection(collections: readonly ZoteroCollection[], reference: string): ZoteroCollection {
  const byKey = collections.find((c) => c.key === reference);
  if (byKey) {
    return byKey;
  }
  const wanted = reference.trim().replace(/^\/+|\/+$/g, '').toLowerCase();
  const byPath = collections.find((c) => c.path.toLowerCase() === wanted);
  if (byPath) {
    return byPath;
  }
  const byName = collections.filter((c) => c.name.toLowerCase() === wanted);
  if (byName.length === 1) {
    return byName[0];
  }
  if (byName.length > 1) {
    const paths = byName.map((c) => `"${c.path}"`).join(', ');
    throw new CollectionNotFoundError(`Several Zotero collections are named "${reference}": ${paths}. Use the full path.`);
  }
  throw new CollectionNotFoundError(`No Zotero collection matches "${reference}".`);
}

/**
 * Converts API collections into `ZoteroCollection`s with full paths.
 *
 * @param raw Collections as returned by the API, in any order.
 */
function withPaths(raw: readonly ApiCollection[]): ZoteroCollection[] {
  const byKey = new Map(raw.map((c) => [c.key, c]));
  const pathOf = (c: ApiCollection): string => {
    const parent = c.data.parentCollection ? byKey.get(c.data.parentCollection) : undefined;
    return parent ? `${pathOf(parent)}/${c.data.name}` : c.data.name;
  };
  return raw.map((c) => ({
    key: c.key,
    name: c.data.name,
    parentKey: c.data.parentCollection || undefined,
    path: pathOf(c),
  }));
}

/**
 * Converts an API item into a `ZoteroItem`.
 *
 * @param raw Item with `data` and `bibtex` included.
 * @returns `undefined` for notes, attachments and anything whose BibTeX
 *   export has no citation key.
 */
function toZoteroItem(raw: ApiItem): ZoteroItem | undefined {
  if (NON_CITABLE_TYPES.has(raw.data.itemType) || !raw.bibtex) {
    return undefined;
  }
  const citeKey = citeKeyOf(raw.bibtex);
  if (!citeKey) {
    return undefined;
  }
  return {
    citeKey,
    bibtex: raw.bibtex,
    title: raw.data.title ?? '',
    creators: (raw.meta?.creatorSummary ?? '').replace(BIDI_ISOLATES, ''),
    year: raw.meta?.parsedDate?.slice(0, 4) ?? '',
    venue: raw.data.publicationTitle ?? raw.data.proceedingsTitle ?? raw.data.repository ?? '',
  };
}
