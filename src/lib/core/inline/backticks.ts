/**
 * Backtick-run indexing for code spans (CommonMark §6.1): a run of N backticks
 * closes with the next run of exactly N. All runs in a region are indexed once,
 * then each opener binary-searches for its closer — a per-opener forward rescan
 * to EOF is O(n) each and turns a run-length ladder quadratic (O(n^1.5)).
 */

/** Backtick-run start positions grouped by run length, ascending within each length. */
export type BacktickRunIndex = Map<number, number[]>;

/** Index every backtick run in [from, end) by its length. */
export function indexBacktickRuns(raw: string, from: number, end: number): BacktickRunIndex {
	const runs: BacktickRunIndex = new Map();
	let i = from;
	while (i < end) {
		if (raw[i] !== '`') {
			i++;
			continue;
		}
		const start = i;
		do {
			i++;
		} while (i < end && raw[i] === '`');
		const len = i - start;
		const positions = runs.get(len);
		if (positions) positions.push(start);
		else runs.set(len, [start]);
	}
	return runs;
}

/**
 * Start of the first run of exactly `tickLen` backticks beginning after
 * `openerStart` (the opener's own run start), or -1 when nothing closes it.
 */
export function findBacktickCloser(
	index: BacktickRunIndex,
	tickLen: number,
	openerStart: number
): number {
	const positions = index.get(tickLen);
	if (!positions) return -1;
	let lo = 0;
	let hi = positions.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		if (positions[mid] <= openerStart) lo = mid + 1;
		else hi = mid;
	}
	return lo < positions.length ? positions[lo] : -1;
}
