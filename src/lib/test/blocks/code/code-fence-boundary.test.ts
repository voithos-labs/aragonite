import { describe, it, expect } from 'vitest';
import {
	classifyFenceBoundary,
	clampEnterOffsetToBody,
	clampRangeToBody,
	crossesFenceBoundary,
	editSpan
} from '#lib/components/blocks/code/code-fence-boundary.js';
import { computeCodeEnter } from '#lib/components/blocks/code/code-enter.js';
import { indentLines } from '#lib/components/blocks/code/code-indent.js';
import { trimTrailingLineEnding } from '#lib/core/lines.js';
import { fencedCode } from './fenced-code-fixture';

describe('classifyFenceBoundary', () => {
	// raw `` ```\ncode\n```\n ``: opener=[0,4) body=[4,9) closer=[9,12) in display
	const closed = fencedCode('```\ncode\n```\n');

	it('Backspace at body start (just past opener `\\n`) exits to previous block', () => {
		expect(classifyFenceBoundary({ node: closed, offset: 4, forward: false })).toEqual({
			kind: 'exitPrev'
		});
	});

	it('Delete at body end (just before closer `\\n`) exits to next block', () => {
		expect(classifyFenceBoundary({ node: closed, offset: 8, forward: true })).toEqual({
			kind: 'exitNext'
		});
	});

	it('Backspace inside body content is allowed', () => {
		expect(classifyFenceBoundary({ node: closed, offset: 5, forward: false })).toEqual({
			kind: 'allow'
		});
		expect(classifyFenceBoundary({ node: closed, offset: 8, forward: false })).toEqual({
			kind: 'allow'
		});
	});

	it('Delete inside body content is allowed', () => {
		expect(classifyFenceBoundary({ node: closed, offset: 4, forward: true })).toEqual({
			kind: 'allow'
		});
		expect(classifyFenceBoundary({ node: closed, offset: 7, forward: true })).toEqual({
			kind: 'allow'
		});
	});

	it('Backspace inside the opener fence falls through (info-string editing)', () => {
		// raw `` ```python\ncode\n```\n ``: opener=[0,10).
		const withInfo = fencedCode('```python\ncode\n```\n', 'python');
		expect(classifyFenceBoundary({ node: withInfo, offset: 9, forward: false })).toEqual({
			kind: 'allow'
		});
		expect(classifyFenceBoundary({ node: withInfo, offset: 10, forward: false })).toEqual({
			kind: 'exitPrev'
		});
	});

	it('Backspace/Delete inside the closer fence falls through', () => {
		expect(classifyFenceBoundary({ node: closed, offset: 10, forward: false })).toEqual({
			kind: 'allow'
		});
		expect(classifyFenceBoundary({ node: closed, offset: 11, forward: true })).toEqual({
			kind: 'allow'
		});
	});

	it('empty body: bodyStart === bodyEnd; both Backspace and Delete at the join exit', () => {
		// raw `` ```\n```\n ``: opener=[0,4) body=[4,4) closer=[4,7).
		const empty = fencedCode('```\n```\n');
		expect(classifyFenceBoundary({ node: empty, offset: 4, forward: false })).toEqual({
			kind: 'exitPrev'
		});
		expect(classifyFenceBoundary({ node: empty, offset: 4, forward: true })).toEqual({
			kind: 'exitNext'
		});
	});

	it('unclosed fence: only the opener boundary guards Backspace; no closer boundary', () => {
		// raw `` ```js\nconst x\n ``: opener=[0,6) body=[6,14), with no closer.
		const unclosed = fencedCode('```js\nconst x\n', 'js', { closed: false });
		expect(classifyFenceBoundary({ node: unclosed, offset: 6, forward: false })).toEqual({
			kind: 'exitPrev'
		});
		expect(classifyFenceBoundary({ node: unclosed, offset: 13, forward: true })).toEqual({
			kind: 'allow'
		});
	});

	it('opener-only fence (no `\\n` yet) allows all in-block editing', () => {
		const fresh = fencedCode('```', '', { closed: false });
		for (const offset of [0, 1, 3]) {
			expect(classifyFenceBoundary({ node: fresh, offset, forward: false })).toEqual({
				kind: 'allow'
			});
			expect(classifyFenceBoundary({ node: fresh, offset, forward: true })).toEqual({
				kind: 'allow'
			});
		}
	});

	// A check that fires between `\r` and `\n` lets the native delete fuse the last body line
	// with the closer.
	it('CRLF body: the closer boundary sits before the whole `\\r\\n`, not inside it', () => {
		// raw "```\r\ncode\r\n```\r\n": opener=[0,5) body=[5,11) closer=[11,14).
		const crlf = fencedCode('```\r\ncode\r\n```\r\n');
		expect(classifyFenceBoundary({ node: crlf, offset: 9, forward: true })).toEqual({
			kind: 'exitNext'
		});
		expect(classifyFenceBoundary({ node: crlf, offset: 10, forward: true })).toEqual({
			kind: 'allow'
		});
	});

	it('CRLF opener boundary is unchanged (the opener line owns its whole ending)', () => {
		const crlf = fencedCode('```\r\ncode\r\n```\r\n');
		expect(classifyFenceBoundary({ node: crlf, offset: 5, forward: false })).toEqual({
			kind: 'exitPrev'
		});
	});

	it('tilde fence is treated identically to backtick', () => {
		// raw `~~~yaml\nkey: 1\n~~~\n`: opener=[0,8) body=[8,15) closer=[15,18) display.
		const tilde = fencedCode('~~~yaml\nkey: 1\n~~~\n', 'yaml', { fenceMarker: '~' });
		expect(classifyFenceBoundary({ node: tilde, offset: 8, forward: false })).toEqual({
			kind: 'exitPrev'
		});
		expect(classifyFenceBoundary({ node: tilde, offset: 14, forward: true })).toEqual({
			kind: 'exitNext'
		});
	});
});

describe('clampEnterOffsetToBody', () => {
	// raw `` ```js\nconst x = 1\n``` \n``: opener text=[0,5), bodyStart=6.
	const closed = fencedCode('```js\nconst x = 1\n```\n', 'js');

	it('clamps a caret before or inside the opener text to the body start', () => {
		for (const offset of [0, 1, 4]) {
			expect(clampEnterOffsetToBody(closed, offset)).toBe(6);
		}
	});

	it('leaves the end of the opener text alone, splicing there is already safe', () => {
		expect(clampEnterOffsetToBody(closed, 5)).toBe(5);
	});

	it('leaves body offsets alone', () => {
		expect(clampEnterOffsetToBody(closed, 6)).toBe(6);
		expect(clampEnterOffsetToBody(closed, 10)).toBe(10);
	});

	// A splice inside the closer text breaks the closer apart and leaves an unclosed fence.
	it('clamps a caret inside the closer text back to the body end', () => {
		expect(clampEnterOffsetToBody(closed, 19)).toBe(17);
		expect(clampEnterOffsetToBody(closed, 20)).toBe(17);
	});

	it('leaves the start of the closer line alone, as it leaves the opener text end', () => {
		expect(clampEnterOffsetToBody(closed, 18)).toBe(18);
	});

	it('CRLF: the closer clamp lands on the body end, not inside the line ending', () => {
		// "```\r\ncode\r\n```\r\n": body [5,9] · closer text [11,14).
		const crlf = fencedCode('```\r\ncode\r\n```\r\n');
		expect(clampEnterOffsetToBody(crlf, 12)).toBe(9);
		expect(clampEnterOffsetToBody(crlf, 11)).toBe(11);
	});

	// An unclosed fence still owns its opener line, so a splice there renders a fence the raw
	// does not hold.
	it('clamps the opener of an unclosed fence, whose body runs to the display end', () => {
		const unclosed = fencedCode('```js\nconst x = 1\n', 'js', { closed: false });
		expect(clampEnterOffsetToBody(unclosed, 0)).toBe(6);
		expect(clampEnterOffsetToBody(unclosed, 3)).toBe(6);
		expect(clampEnterOffsetToBody(unclosed, 10)).toBe(10);
	});

	it('opener-only fence clamps interior offsets to the opener end', () => {
		const fresh = fencedCode('```', '', { closed: false });
		expect(clampEnterOffsetToBody(fresh, 1)).toBe(3);
		expect(clampEnterOffsetToBody(fresh, 3)).toBe(3);
	});

	it('Enter at raw offset 0 keeps the opener intact and adds a blank first body line', () => {
		const display = trimTrailingLineEnding(closed.raw);
		const offset = clampEnterOffsetToBody(closed, 0);
		const enter = computeCodeEnter({
			display,
			selection: { start: offset, end: offset },
			mode: 'normal',
			ending: '\n'
		});
		expect(enter.newText).toBe('```js\n\nconst x = 1\n```');
		expect(enter.newCursor).toBe(7);
	});
});

// ── Line-rewriting gestures clamp to the body ────────────────────────────────

describe('clampRangeToBody', () => {
	// raw "```js\nconst x = 1\n```\n": opener=[0,6) body display=[6,17) closer=[18,21).
	const closed = fencedCode('```js\nconst x = 1\n```\n', 'js');

	it('leaves a body-only range untouched', () => {
		expect(clampRangeToBody(closed, { start: 8, end: 12 })).toEqual({ start: 8, end: 12 });
	});

	it('pulls a range reaching the closer line start back to the body end', () => {
		expect(clampRangeToBody(closed, { start: 6, end: 18 })).toEqual({ start: 6, end: 17 });
	});

	it('pushes a range starting in the opener line down to the body start', () => {
		expect(clampRangeToBody(closed, { start: 0, end: 17 })).toEqual({ start: 6, end: 17 });
	});

	it('collapses a caret inside a fence line onto the nearest body edge', () => {
		expect(clampRangeToBody(closed, { start: 2, end: 2 })).toEqual({ start: 6, end: 6 });
		expect(clampRangeToBody(closed, { start: 20, end: 20 })).toEqual({ start: 17, end: 17 });
	});

	it('an unclosed fence clamps only at the opener; its body runs to the display end', () => {
		const unclosed = fencedCode('```js\nconst x\n', 'js', { closed: false });
		expect(clampRangeToBody(unclosed, { start: 0, end: 13 })).toEqual({ start: 6, end: 13 });
	});

	it('a fence with no body line yet collapses every offset onto the display end', () => {
		const fresh = fencedCode('```\n', '', { closed: false });
		expect(clampRangeToBody(fresh, { start: 0, end: 3 })).toEqual({ start: 3, end: 3 });
	});

	// A closer indented past the 3-space limit stops closing the fence, which then absorbs
	// every following block into the code body.
	it('Tab over a body line leaves the closer at column 0', () => {
		const display = trimTrailingLineEnding(closed.raw);
		const indented = indentLines(display, clampRangeToBody(closed, { start: 6, end: 18 }));
		expect(indented.text).toBe('```js\n\tconst x = 1\n```');
	});

	it('Shift+Up into the opener leaves the opener at column 0', () => {
		const display = trimTrailingLineEnding(closed.raw);
		const indented = indentLines(display, clampRangeToBody(closed, { start: 0, end: 17 }));
		expect(indented.text).toBe('```js\n\tconst x = 1\n```');
	});
});

// ── Ranged edits clamp only where they cross ─────────────────────────────────

describe('crossesFenceBoundary', () => {
	// display "```js\nconst x = 1\n```": marker run [0,3) · info [3,5) · body [6,17] ·
	// closer text [18,21).
	const closed = fencedCode('```js\nconst x = 1\n```\n', 'js');

	it('is false only inside the body or the info string', () => {
		expect(crossesFenceBoundary(closed, { start: 8, end: 14 })).toBe(false);
		expect(crossesFenceBoundary(closed, { start: 3, end: 5 })).toBe(false);
	});

	// Parser-verified: deleting one closer backtick swallows every following block into the
	// code node, and retyping the opener run demotes the block into an absorbing opener.
	it('is true inside either marker run of a closed fence', () => {
		expect(crossesFenceBoundary(closed, { start: 18, end: 21 })).toBe(true); // closer text
		expect(crossesFenceBoundary(closed, { start: 0, end: 3 })).toBe(true); // opener markers
		expect(crossesFenceBoundary(closed, { start: 2, end: 4 })).toBe(true); // markers → info
		expect(crossesFenceBoundary(closed, { start: 19, end: 19 })).toBe(true); // caret in closer
		expect(crossesFenceBoundary(closed, { start: 1, end: 1 })).toBe(true); // caret in markers
	});

	it('is true for a range that reaches past either fence boundary', () => {
		expect(crossesFenceBoundary(closed, { start: 12, end: 20 })).toBe(true);
		expect(crossesFenceBoundary(closed, { start: 3, end: 9 })).toBe(true);
		expect(crossesFenceBoundary(closed, { start: 0, end: 21 })).toBe(true);
	});

	// A fence with no closer has nothing to orphan: retyping the markers is how a just-typed
	// ` ``` ` is undone, and it demotes the block without absorbing anything (parser-verified).
	it('is false inside the marker run of an unclosed fence', () => {
		const unclosed = fencedCode('```js\nconst x\n', 'js', { closed: false });
		expect(crossesFenceBoundary(unclosed, { start: 0, end: 3 })).toBe(false);
		expect(crossesFenceBoundary(unclosed, { start: 0, end: 5 })).toBe(false);
		expect(crossesFenceBoundary(unclosed, { start: 1, end: 1 })).toBe(false);
	});

	it('treats the opener indentation as structure: a fourth space demotes the block', () => {
		const indented = fencedCode(' ```js\nconst x = 1\n ```\n', 'js');
		expect(crossesFenceBoundary(indented, { start: 0, end: 1 })).toBe(true);
		expect(crossesFenceBoundary(indented, { start: 4, end: 6 })).toBe(false); // info string
	});

	// GFM's indentation limit is the scan's limit: three spaces still open a fence, so the info
	// string past them is content, and a line whose markers sit past it is not an opener at all.
	it('reads the info string at the 3-space limit and nothing past it', () => {
		const legal = fencedCode('   ```js\nconst x = 1\n   ```\n', 'js');
		expect(crossesFenceBoundary(legal, { start: 6, end: 8 })).toBe(false); // "js"
		expect(crossesFenceBoundary(legal, { start: 2, end: 5 })).toBe(true);

		// Defensive, not parser-producible: a raw the grammar would read as indented
		// code. Nothing on that opener line is content, info-string-looking or not.
		const overIndented = fencedCode('    ```js\nconst x = 1\n```\n', 'js');
		expect(crossesFenceBoundary(overIndented, { start: 7, end: 9 })).toBe(true);
	});

	// The collapsed-caret gestures the browser ranges for us: a Backspace at the body
	// start or at the closer line's start targets a structural line ending.
	it('is true for a lone structural line ending', () => {
		expect(crossesFenceBoundary(closed, { start: 5, end: 6 })).toBe(true);
		expect(crossesFenceBoundary(closed, { start: 17, end: 18 })).toBe(true);
	});

	it('is false for a collapsed caret anywhere in the body', () => {
		for (const offset of [6, 11, 17]) {
			expect(crossesFenceBoundary(closed, { start: offset, end: offset })).toBe(false);
		}
	});

	it('reads a backwards range by its endpoints, not their order', () => {
		expect(crossesFenceBoundary(closed, { start: 20, end: 12 })).toBe(true);
	});

	it('CRLF: the boundary is the whole `\\r\\n`, not a position inside it', () => {
		// "```\r\ncode\r\n```\r\n": opener text [0,3) · body [5,9] · closer text [11,14).
		const crlf = fencedCode('```\r\ncode\r\n```\r\n');
		expect(crossesFenceBoundary(crlf, { start: 6, end: 8 })).toBe(false);
		expect(crossesFenceBoundary(crlf, { start: 6, end: 10 })).toBe(true);
		expect(crossesFenceBoundary(crlf, { start: 3, end: 5 })).toBe(true);
	});

	it('an unclosed fence has no closer region; its body runs to the display end', () => {
		// "```js\nconst x\n": opener text [0,5) · body [6,13].
		const unclosed = fencedCode('```js\nconst x\n', 'js', { closed: false });
		expect(crossesFenceBoundary(unclosed, { start: 6, end: 13 })).toBe(false);
		expect(crossesFenceBoundary(unclosed, { start: 4, end: 13 })).toBe(true);
	});

	it('an empty-body fence protects both marker runs and the line ending between', () => {
		// "```\n```": opener markers [0,3) · empty info [3,3] · body [4,4] · closer [4,7).
		const empty = fencedCode('```\n```\n');
		expect(crossesFenceBoundary(empty, { start: 3, end: 4 })).toBe(true);
		expect(crossesFenceBoundary(empty, { start: 0, end: 3 })).toBe(true);
		expect(crossesFenceBoundary(empty, { start: 4, end: 7 })).toBe(true);
		// The empty info string is still a place to type a language into.
		expect(crossesFenceBoundary(empty, { start: 3, end: 3 })).toBe(false);
	});

	// The block a user has just typed ` ``` ` into: no closer, so selecting it all and
	// deleting must still work, or the fence could never be un-typed.
	it('an opener-only fence is all one region', () => {
		const fresh = fencedCode('```', '', { closed: false });
		expect(crossesFenceBoundary(fresh, { start: 0, end: 3 })).toBe(false);
	});
});

// Where the fence lines are hidden, a range holding no body is declined rather than moved onto a
// body edge; the routes that ask are run in `code-fence-edit-span.test.ts`.
describe('editSpan', () => {
	const closed = fencedCode('```js\nconst x = 1\n```\n', 'js');
	const span = (start: number, end: number) => ({ start, end });

	it.each([
		['a body range', span(8, 14), span(8, 14)],
		['a backwards range, ordered', span(14, 8), span(8, 14)],
		['the info string', span(3, 5), span(3, 5)],
		['a caret in the body', span(8, 8), span(8, 8)],
		['a caret in the info string', span(4, 4), span(4, 4)],
		['a body-into-closer range, cut to the body', span(12, 20), span(12, 17)],
		['an opener-into-body range, cut to the body', span(3, 9), span(6, 9)],
		['the whole display, cut to the body', span(0, 21), span(6, 17)],
		["the body's own line ending", span(17, 18), null],
		["the opener's line ending", span(5, 6), null],
		['the closer text', span(18, 21), null],
		['the opener marker run', span(0, 3), null],
		['a caret in the closer run', span(19, 19), null]
	])('hidden fence lines: %s', (_name, range, expected) => {
		expect(editSpan(closed, range, false)).toEqual(expected);
	});

	it('shown fence lines: the range itself, ordered, structure included', () => {
		expect(editSpan(closed, span(20, 12), true)).toEqual(span(12, 20));
		expect(editSpan(closed, span(18, 21), true)).toEqual(span(18, 21));
	});

	it('hidden fence lines: an unclosed fence’s marker run is content, nothing to orphan', () => {
		const unclosed = fencedCode('```js\nconst x\n', 'js', { closed: false });
		expect(editSpan(unclosed, span(0, 3), false)).toEqual(span(0, 3));
	});
});
