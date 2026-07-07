/**
 * Backtick-run matching for code spans (CommonMark §6.1): a run of N
 * backticks closes only with a later run of exactly N.
 */

export interface BacktickRunMatch {
	tickLen: number;
	/** Start of the first equal-length closing run, or -1 when unmatched. */
	closeStart: number;
}

/** Measure the backtick run opening at `tickStart` and find its closer. */
export function matchBacktickRun(raw: string, tickStart: number, end: number): BacktickRunMatch {
	let pos = tickStart;
	while (pos < end && raw[pos] === '`') pos++;
	const tickLen = pos - tickStart;

	let searchPos = pos;
	while (searchPos < end) {
		if (raw[searchPos] === '`') {
			const closeStart = searchPos;
			while (searchPos < end && raw[searchPos] === '`') searchPos++;
			if (searchPos - closeStart === tickLen) return { tickLen, closeStart };
		} else {
			searchPos++;
		}
	}
	return { tickLen, closeStart: -1 };
}
