/**
 * The bounded decline for a recognizer whose grammar has no early-stop byte: candidate
 * positions are collected once per block and each consultation is a binary search, so a
 * trigger-dense paragraph costs one scan instead of one per trigger. The index memoizes
 * per raw, bounded (cap 2) rather than weak-keyed because a string cannot key a WeakMap.
 */

import { createBoundedMemo } from './bounded-memo';

/**
 * `collect` scans one block's raw left to right into ascending positions; the returned
 * lookup answers the first collected position at or after `from`, or -1 when none remains.
 */
export function createScanIndex(
	collect: (raw: string) => Int32Array
): (raw: string, from: number) => number {
	const positionIndex = createBoundedMemo<string, Int32Array>({ cap: 2 });
	return (raw, from) => {
		const positions = positionIndex(raw, () => collect(raw));
		let lo = 0;
		let hi = positions.length;
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			if (positions[mid] < from) lo = mid + 1;
			else hi = mid;
		}
		return lo < positions.length ? positions[lo] : -1;
	};
}
