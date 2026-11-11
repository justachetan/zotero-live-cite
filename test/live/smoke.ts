/**
 * Manual smoke check against the real Zotero app (not part of `npm test`).
 *
 *   npm run smoke -- <key prefix> [collection]
 *
 * Prints what completion would offer, and how long the search took, so you can
 * confirm the local API is enabled and keys match your existing .bib files.
 * Set ZOTERO_LIBRARY_URL to search a group library.
 */

import { DEFAULT_LIBRARY_URL, ZoteroClient } from '../../src/zoteroClient';

/**
 * Runs one search and prints the results.
 */
async function main(): Promise<void> {
  const [keyPrefix = '', collection = ''] = process.argv.slice(2);
  const client = new ZoteroClient(process.env.ZOTERO_LIBRARY_URL ?? DEFAULT_LIBRARY_URL);
  const started = performance.now();
  const items = await client.search(keyPrefix, collection);
  const elapsed = Math.round(performance.now() - started);
  console.log(`${items.length} result(s) for "${keyPrefix}"${collection ? ` in "${collection}"` : ''} in ${elapsed} ms`);
  for (const item of items) {
    console.log(`  ${item.citeKey.padEnd(40)} ${item.creators} (${item.year}) ${item.title.slice(0, 60)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
