/**
 * The empty delimiter pair the auto-pair last wrote, one record per editor: only that pair is its
 * to step over, collapse or delete, since the same bytes typed by hand are the user's. It holds
 * while the pair and the text either side are the bytes the write left, so typing inside keeps
 * it; an edit outside it, or a key with the caret elsewhere or in another block, ends it.
 */

import type { ContentRange } from '../../../core/inline';

export interface AutoPairRecord {
	/** A view of the record for one block; each call is a new block identity. */
	forBlock(): BlockAutoPairs;
}

export interface BlockAutoPairs {
	/**
	 * The pair the auto-pair wrote, when it is still empty and `caret` sits between its runs or
	 * just past it (a stepped-over partner). A caret anywhere else ends the record.
	 */
	consult(text: string, caret: number): ContentRange | null;
	/** Record the empty pair a write left at `pair` in `text`. */
	remember(text: string, pair: ContentRange): void;
	/** The key closed, deleted or dropped the pair. */
	forget(): void;
}

interface Written {
	block: object;
	before: string;
	run: string;
	after: string;
}

export function createAutoPairRecord(): AutoPairRecord {
	let written: Written | null = null;
	return {
		forBlock() {
			const block = {};
			return {
				consult(text, caret) {
					const pair = written?.block === block ? pairIn(written, text) : null;
					const k = written?.run.length ?? 0;
					const inBody = pair !== null && caret >= pair.start + k && caret <= pair.end - k;
					const empty = pair !== null && pair.end - pair.start === 2 * k;
					if (!pair || !(inBody || (empty && caret === pair.end))) {
						written = null;
						return null;
					}
					return empty ? pair : null;
				},
				remember(text, pair) {
					const k = (pair.end - pair.start) / 2;
					written = {
						block,
						before: text.slice(0, pair.start),
						run: text.slice(pair.start, pair.start + k),
						after: text.slice(pair.end)
					};
				},
				forget() {
					written = null;
				}
			};
		}
	};
}

// Where the written pair sits in `text` now, body included, or null once the bytes differ.
function pairIn({ before, run, after }: Written, text: string): ContentRange | null {
	const start = before.length;
	const end = text.length - after.length;
	if (end - start < 2 * run.length) return null;
	if (!text.startsWith(before) || !text.endsWith(after)) return null;
	if (!text.startsWith(run, start) || !text.startsWith(run, end - run.length)) return null;
	return { start, end };
}
