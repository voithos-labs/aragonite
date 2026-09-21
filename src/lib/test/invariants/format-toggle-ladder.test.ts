// @vitest-environment jsdom
//
// G2.14: over a range, the pressed-state read and the toggle's direction decide by the same
// checks, so an active range unapplies. One case sits outside, in one mode: where the delimiters
// paint, a bare wrap writes its literal bytes without verifying them (live-mode.md § 4.3). A
// decline is excused, so a new corpus line fails nothing on its own; a shape that should write
// needs a unit test. Miss-analysis: the equivalence lived only in prose, so a fourth branch on one
// side and not the other would send writes to the wrong place in silence.
import { describe, it, expect } from 'vitest';
import {
	isInlineFormatActive,
	isInlineFormatActiveAfter,
	toggleInlineFormat,
	type InlineFormatEdit,
	type ToggleInlineFormatResult
} from '$lib/core/inline/format-toggle';
import { paintsFocusedMarkers, type PresentationMode } from '$lib/presentation-mode';
import { listInlineMarks } from '$lib/schema/inline-construct-policy';

/** Shapes the naive reading breaks on: nesting same-kind, cross-kind and interleaved, non-canonical
 *  runs, a literal delimiter, an empty pair, a code span's opaque bytes, escapes at both construct
 *  edges, an entity, a multi-unit scalar and a combining cluster against a delimiter, an autolink
 *  the run encloses, a line that IS one run, in both spellings, and whitespace at both edges. */
const CORPUS = [
	'alpha beta',
	'*ab*',
	'_ab_',
	'**bold** tail',
	'*em* and **st**',
	'***both*** x',
	'__under__ run',
	'_it_ and __b__',
	'~~del~~ ~sub~',
	'`code` span',
	'`a**b**c` x',
	'a *b* c *d* e',
	'* literal star',
	'x ** y ** z',
	'  padded  ',
	'a\\*escaped\\* b',
	'**a `c` b**',
	'~~**mix**~~ t',
	'~~a ~b~ c~~',
	'**a **b** c**',
	'**a *b** c*',
	'~~~del~~~ tail',
	'x **** y z',
	'\\*a* and *b\\*',
	'a &amp; b c',
	'**a&amp;b** tail',
	'*😀* and x y',
	'*e\u0301* and x y',
	'*https://x.y/a* t'
];

const MODES: (PresentationMode | undefined)[] = ['source', 'live'];

interface Range {
	start: number;
	end: number;
}

/** The trim the cross-block decomposition applies before it ever asks (`format-range.ts`): a run
 *  opens and closes against a word, never a space, so an untrimmed edge is a different question. */
function trimmed(display: string, from: number, to: number): Range | null {
	let start = from;
	let end = to;
	while (start < end && /\s/.test(display[start])) start++;
	while (end > start && /\s/.test(display[end - 1])) end--;
	return start === end ? null : { start, end };
}

/** Every trimmed range the line offers, collapsed pairs excluded: a caret takes its own branch,
 *  which inserts an empty pair no parse can see, and that is a different set of rules. */
function rangesOf(display: string): Range[] {
	const seen = new Set<string>();
	const ranges: Range[] = [];
	for (let from = 0; from <= display.length; from++)
		for (let to = from + 1; to <= display.length; to++) {
			const range = trimmed(display, from, to);
			if (!range || seen.has(`${range.start}:${range.end}`)) continue;
			seen.add(`${range.start}:${range.end}`);
			ranges.push(range);
		}
	return ranges;
}

/** The result is the selection, or its whitespace trim, with bytes spliced around it and nothing
 *  else touched: the bare wrap, which only a mode that paints markers may write unverified. */
function isBareWrap(display: string, selection: Range, result: ToggleInlineFormatResult): boolean {
	const wrapped = result.newDisplay.slice(result.newSelStart, result.newSelEnd);
	return [selection, trimmed(display, selection.start, selection.end)].some(
		(core) =>
			core !== null &&
			result.newDisplay === display.slice(0, core.start) + wrapped + display.slice(core.end)
	);
}

describe('G2.14 — the pressed-state read and the toggle direction', () => {
	for (const { kind } of listInlineMarks()) {
		it(`${kind}: an active range unapplies, an inactive one applies`, () => {
			const violations: string[] = [];
			const flipsByLine = new Map<string, number>();
			let flips = 0;
			for (const display of CORPUS) {
				const content = { start: 0, end: display.length };
				for (const selection of rangesOf(display)) {
					const edit: InlineFormatEdit = { display, content, selection };
					const active = isInlineFormatActive(edit, kind);
					for (const mode of MODES) {
						const result = toggleInlineFormat(edit, kind, mode);
						// Declining is sound in both directions: a toggle's fallback is not writing.
						if (!result) continue;
						const excused =
							!active &&
							paintsFocusedMarkers(mode ?? 'source') &&
							isBareWrap(display, selection, result);
						if (isInlineFormatActiveAfter(edit, result, kind) !== active) {
							flips++;
							flipsByLine.set(display, (flipsByLine.get(display) ?? 0) + 1);
						} else if (!excused) {
							violations.push(
								`${mode} ${JSON.stringify(display)} [${selection.start},${selection.end}] ` +
									`was ${active ? 'active' : 'inactive'} and wrote ${JSON.stringify(result.newDisplay)}`
							);
						}
					}
				}
			}
			expect(violations).toEqual([]);
			// The sweep proves nothing where a line declined its way out, and a line's own collapse
			// disappears into a total this large, so both floors stand: per line, then over the corpus.
			expect(CORPUS.filter((line) => (flipsByLine.get(line) ?? 0) < 5)).toEqual([]);
			expect(flips).toBeGreaterThan(500);
		});
	}
});
