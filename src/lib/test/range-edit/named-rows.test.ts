// @vitest-environment jsdom
// The named rows against the range-edit core (G4.311). A row first meets the laws it falls under
// (a stated copy L10, a stated paste at a caret L9, a stated caret L8), so no row can state what
// the laws contradict; then the core must give exactly what the row states.

import { describe, expect, it } from 'vitest';
import { editRange, type Gesture, type RangeEditResult } from '#lib/range-edit/edit-range.js';
import { caretLaw, copyMarkers, pasteAtCaret, type Call } from './laws';
import { NAMED_ROWS, rangeOf, unmark } from './named-rows';
import { checkHost, type CheckHost } from './test-host';

function differences(got: RangeEditResult, want: Partial<RangeEditResult>): string[] {
	const q = JSON.stringify;
	const out: string[] = [];
	if (want.source !== undefined && got.source !== want.source)
		out.push(`source ${q(got.source)}, wanted ${q(want.source)}`);
	if (want.clipboard !== undefined && got.clipboard !== want.clipboard)
		out.push(`clipboard ${q(got.clipboard)}, wanted ${q(want.clipboard)}`);
	if (want.caret !== undefined && q(got.caret) !== q(want.caret))
		out.push(`caret ${q(got.caret)}, wanted ${q(want.caret)}`);
	return out;
}

/** The laws a row's first call falls under, on the core's own answers. */
function lawsOf(host: CheckHost, row: (typeof NAMED_ROWS)[number]): string[] {
	const call: Call = (source, range, gesture, mode) =>
		editRange(source, range, gesture, mode, host);
	const mode = row.mode ?? 'source';
	const source = unmark(row.source);
	const range = rangeOf(row.source);
	const out: string[] = [];
	if (row.gesture === 'copy' || row.gesture === 'cut')
		out.push(...copyMarkers(call, host, { source, mode, range }));
	const { gesture } = row;
	if (
		typeof gesture === 'object' &&
		'paste' in gesture &&
		!gesture.plain &&
		range.from === range.to
	)
		out.push(
			...pasteAtCaret(call, host, {
				source,
				mode,
				at: range.from,
				holds: gesture.holds,
				text: gesture.paste
			})
		);
	for (const want of [row.expect, row.then?.expect]) {
		if (want?.source !== undefined && want.caret)
			out.push(...caretLaw(host, want as RangeEditResult, row.name));
	}
	return out;
}

describe('the named rows', () => {
	for (const row of NAMED_ROWS) {
		it(row.name, () => {
			const host = checkHost();
			expect(lawsOf(host, row), 'the laws this row falls under').toEqual([]);
			const mode = row.mode ?? 'source';
			const first = editRange(unmark(row.source), rangeOf(row.source), row.gesture, mode, host);
			expect(differences(first, row.expect)).toEqual([]);
			if (!row.then) return;
			const back = {
				paste: (first.clipboard ?? '').replace(/\r\n/g, '\n'),
				plain: false,
				holds: first.caret.holds
			};
			const gesture: Gesture =
				row.then.gesture === 'paste back'
					? back
					: row.then.gesture === 'paste back with own'
						? { ...back, own: first.own }
						: row.then.gesture;
			const at = row.then.at ?? first.caret.at;
			const on = row.then.source ?? first.source;
			const second = editRange(on, { from: at, to: at }, gesture, mode, host);
			expect(differences(second, row.then.expect)).toEqual([]);
		});
	}
});
