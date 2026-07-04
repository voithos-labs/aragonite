/**
 * Per-rescan index of document matches, keyed by the leaf path that owns them.
 * Built once when the match set changes so each MatchOverlay reads only its own
 * leaf's matches instead of scanning the whole document on every scroll.
 */

import type { Match } from './document-scan';

/**
 * A match paired with its position in the flat `matches` list — the index the
 * active-highlight compares against `activeIndex`.
 */
export interface IndexedMatch {
	match: Match;
	index: number;
}

/** Stable string key for a block path. Distinct paths never collide: elements
 *  are numbers joined by a separator that can't appear within one. */
export function pathKey(path: readonly number[]): string {
	return path.join(',');
}

/** Group matches by owning leaf path, preserving each match's flat index. */
export function groupMatchesByPath(matches: readonly Match[]): Map<string, IndexedMatch[]> {
	const byPath = new Map<string, IndexedMatch[]>();
	matches.forEach((match, index) => {
		const key = pathKey(match.path);
		const bucket = byPath.get(key);
		if (bucket) bucket.push({ match, index });
		else byPath.set(key, [{ match, index }]);
	});
	return byPath;
}
