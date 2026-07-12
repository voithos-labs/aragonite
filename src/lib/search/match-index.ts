/**
 * Per-rescan indexes of document matches — by owning leaf path, and by
 * ancestor prefix for grid surfaces. Built once when the match set changes so
 * each MatchOverlay reads only its own bucket instead of scanning the whole
 * document on every scroll.
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
		push(byPath, pathKey(match.path), match, index);
	});
	return byPath;
}

/**
 * Group matches under every strict ancestor prefix of their owning path (the
 * root prefix excluded — that bucket would be the whole list). Grid surfaces
 * (table) paint descendant cell matches themselves because cells have no
 * BlockHost overlay; this lets them read one bucket instead of scanning the
 * full match list.
 */
export function groupMatchesByAncestor(matches: readonly Match[]): Map<string, IndexedMatch[]> {
	const byAncestor = new Map<string, IndexedMatch[]>();
	matches.forEach((match, index) => {
		for (let len = 1; len < match.path.length; len++) {
			push(byAncestor, pathKey(match.path.slice(0, len)), match, index);
		}
	});
	return byAncestor;
}

function push(map: Map<string, IndexedMatch[]>, key: string, match: Match, index: number): void {
	const bucket = map.get(key);
	if (bucket) bucket.push({ match, index });
	else map.set(key, [{ match, index }]);
}
