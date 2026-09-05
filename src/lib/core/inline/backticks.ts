/**
 * Backtick-run indexing for code spans (CommonMark §6.1): a run of N backticks closes with the
 * next run of exactly N. Indexed once, then binary-searched per opener, because a per-opener
 * forward rescan to EOF turns a run-length ladder quadratic.
 */

/**
 * Wrap `content` as a code span. The fence runs one backtick past the longest run it encloses, so
 * nothing inside can close it; content touching a backtick at either edge takes a space pad too,
 * without which the fence and that byte merge into one longer run and the span closes elsewhere.
 */
export function wrapAsCodeSpan(content: string): string {
	const fence = '`'.repeat(longestBacktickRun(content) + 1);
	const pad = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
	return fence + pad + content + pad + fence;
}

function longestBacktickRun(text: string): number {
	let longest = 0;
	let run = 0;
	for (const char of text) {
		run = char === '`' ? run + 1 : 0;
		if (run > longest) longest = run;
	}
	return longest;
}

/** Run start positions by run length, ascending within each length. */
export type BacktickRunIndex = Map<number, number[]>;

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

/** First run of exactly `tickLen` starting after `openerStart`, or -1 when nothing closes it. */
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
