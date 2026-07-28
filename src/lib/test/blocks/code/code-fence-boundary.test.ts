import { describe, it, expect } from 'vitest';
import {
	classifyFenceBoundary,
	clampEnterOffsetToBody,
	clampRangeToBody,
	computeFenceRangedEdit,
	crossesFenceBoundary,
	fenceEditSpan
} from '../../../components/blocks/code/code-fence-boundary';
import { computeCodeEnter } from '../../../components/blocks/code/code-enter';
import { indentLines } from '../../../components/blocks/code/code-indent';
import { trimTrailingLineEnding } from '../../../core/lines';
import type { CstNode } from '../../../core/nodes';

function fencedCode(
	raw: string,
	info = '',
	closed = true,
	fenceMarker: '`' | '~' = '`',
	fenceLength = 3
): CstNode {
	return {
		kind: 'fencedCode',
		leadingTrivia: '',
		raw,
		metadata: { fenceMarker, fenceLength, info, closed }
	};
}

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
		// offset===bodyStart (10) is still the boundary.
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
		// raw `` ```js\nconst x\n ``: opener=[0,6) body=[6,14) — no closer.
		const unclosed = fencedCode('```js\nconst x\n', 'js', false);
		expect(classifyFenceBoundary({ node: unclosed, offset: 6, forward: false })).toEqual({
			kind: 'exitPrev'
		});
		// Without a closer, Delete-at-anywhere allows native handling.
		expect(classifyFenceBoundary({ node: unclosed, offset: 13, forward: true })).toEqual({
			kind: 'allow'
		});
	});

	it('opener-only fence (no `\\n` yet) allows all in-block editing', () => {
		const fresh = fencedCode('```', '', false);
		for (const offset of [0, 1, 3]) {
			expect(classifyFenceBoundary({ node: fresh, offset, forward: false })).toEqual({
				kind: 'allow'
			});
			expect(classifyFenceBoundary({ node: fresh, offset, forward: true })).toEqual({
				kind: 'allow'
			});
		}
	});

	// `bodyEnd = closerStart - 1` assumed a one-character line ending, so in a CRLF
	// document the guard fired at the offset BETWEEN `\r` and `\n` and allowed the
	// native forward delete at the real body end — which eats the whole ending and
	// fuses the last body line with the closer.
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
		const tilde = fencedCode('~~~yaml\nkey: 1\n~~~\n', 'yaml', true, '~');
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

	it('leaves the end of the opener text alone — splicing there is already safe', () => {
		expect(clampEnterOffsetToBody(closed, 5)).toBe(5);
	});

	it('leaves body offsets alone', () => {
		expect(clampEnterOffsetToBody(closed, 6)).toBe(6);
		expect(clampEnterOffsetToBody(closed, 10)).toBe(10);
	});

	// The closer-side mirror. Splicing at 19 broke the closer apart —
	// "```js\nconst x = 1\n`\n``" — leaving an unclosed fence.
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

	it('opener-only fence clamps interior offsets to the opener end', () => {
		const fresh = fencedCode('```', '', false);
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
		// Caret stays with the content, now on the second body line.
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
		const unclosed = fencedCode('```js\nconst x\n', 'js', false);
		expect(clampRangeToBody(unclosed, { start: 0, end: 13 })).toEqual({ start: 6, end: 13 });
	});

	it('a fence with no body line yet collapses every offset onto the display end', () => {
		const fresh = fencedCode('```\n', '', false);
		expect(clampRangeToBody(fresh, { start: 0, end: 3 })).toEqual({ start: 3, end: 3 });
	});

	// Shift+Down over the last body line lands the focus at the closer line's start.
	// Tab then indented the closer past the 3-space limit, so the fence no longer
	// closed — on reload it absorbed every following block into the code body.
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
		expect(crossesFenceBoundary(closed, { start: 8, end: 14 })).toBe(false); // body
		expect(crossesFenceBoundary(closed, { start: 3, end: 5 })).toBe(false); // info string
	});

	// Parser-verified: deleting one closer backtick leaves "```js\nconst x = 1\n``\n",
	// which swallows every following block into the code node. Same for the opener's
	// marker run — the block demotes and its closer becomes an absorbing opener.
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

	// A fence with no closer has nothing to orphan: retyping the markers is how a
	// just-typed ` ``` ` is undone, and it demotes the block to a paragraph without
	// absorbing anything (parser-verified).
	it('is false inside the marker run of an UNCLOSED fence', () => {
		const unclosed = fencedCode('```js\nconst x\n', 'js', false);
		expect(crossesFenceBoundary(unclosed, { start: 0, end: 3 })).toBe(false);
		expect(crossesFenceBoundary(unclosed, { start: 0, end: 5 })).toBe(false);
		expect(crossesFenceBoundary(unclosed, { start: 1, end: 1 })).toBe(false);
	});

	it('treats the opener indentation as structure — a fourth space demotes the block', () => {
		const indented = fencedCode(' ```js\nconst x = 1\n ```\n', 'js');
		expect(crossesFenceBoundary(indented, { start: 0, end: 1 })).toBe(true);
		expect(crossesFenceBoundary(indented, { start: 4, end: 6 })).toBe(false); // info string
	});

	// GFM's indentation limit is the scan's limit: three spaces still open a fence, so
	// the info string past them is content. A line whose markers sit past the limit is
	// not an opener the grammar recognizes, and nothing on it is editable.
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
		const unclosed = fencedCode('```js\nconst x\n', 'js', false);
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
	// deleting must still work — otherwise the fence cannot be un-typed.
	it('an opener-only fence is all one region', () => {
		const fresh = fencedCode('```', '', false);
		expect(crossesFenceBoundary(fresh, { start: 0, end: 3 })).toBe(false);
	});
});

describe('fenceEditSpan', () => {
	const closed = fencedCode('```js\nconst x = 1\n```\n', 'js');

	it('leaves a non-crossing range alone, ordering its endpoints', () => {
		expect(fenceEditSpan(closed, { start: 8, end: 14 })).toEqual({ start: 8, end: 14 });
		expect(fenceEditSpan(closed, { start: 14, end: 8 })).toEqual({ start: 8, end: 14 });
		expect(fenceEditSpan(closed, { start: 3, end: 5 })).toEqual({ start: 3, end: 5 });
	});

	it('intersects a crossing range with the body', () => {
		expect(fenceEditSpan(closed, { start: 12, end: 20 })).toEqual({ start: 12, end: 17 });
		expect(fenceEditSpan(closed, { start: 3, end: 9 })).toEqual({ start: 6, end: 9 });
		expect(fenceEditSpan(closed, { start: 0, end: 21 })).toEqual({ start: 6, end: 17 });
	});

	it('collapses a fence-only range to an empty span', () => {
		expect(fenceEditSpan(closed, { start: 17, end: 18 })).toEqual({ start: 17, end: 17 });
		expect(fenceEditSpan(closed, { start: 5, end: 6 })).toEqual({ start: 6, end: 6 });
		expect(fenceEditSpan(closed, { start: 18, end: 21 })).toEqual({ start: 17, end: 17 });
		expect(fenceEditSpan(closed, { start: 0, end: 3 })).toEqual({ start: 6, end: 6 });
	});
});

describe('computeFenceRangedEdit', () => {
	const closed = fencedCode('```js\nconst x = 1\n```\n', 'js');

	it('deletes only the body half of a body-into-closer range', () => {
		expect(computeFenceRangedEdit(closed, { start: 12, end: 20 }, '')).toEqual({
			newText: '```js\nconst \n```',
			newCursor: 12
		});
	});

	it('types over only the body half, landing the caret past the inserted text', () => {
		expect(computeFenceRangedEdit(closed, { start: 12, end: 20 }, 'Z')).toEqual({
			newText: '```js\nconst Z\n```',
			newCursor: 13
		});
	});

	it('keeps the opener line when the range starts inside it', () => {
		expect(computeFenceRangedEdit(closed, { start: 3, end: 9 }, '')).toEqual({
			newText: '```js\nst x = 1\n```',
			newCursor: 6
		});
	});

	it('empties the body — never the block — for a whole-display range', () => {
		expect(computeFenceRangedEdit(closed, { start: 0, end: 21 }, '')).toEqual({
			newText: '```js\n\n```',
			newCursor: 6
		});
	});

	it('splices a non-crossing range verbatim, fence text included', () => {
		expect(computeFenceRangedEdit(closed, { start: 3, end: 5 }, 'py')).toEqual({
			newText: '```py\nconst x = 1\n```',
			newCursor: 5
		});
	});

	// An edit whose range has no body to rewrite is refused outright rather than
	// re-sited: a character aimed at a fence must not land where the user never
	// pointed, and the fence itself is not editable content.
	it('returns null for a range with no body intersection, insertion or not', () => {
		expect(computeFenceRangedEdit(closed, { start: 17, end: 18 }, '')).toBeNull();
		expect(computeFenceRangedEdit(closed, { start: 18, end: 21 }, '```')).toBeNull();
		expect(computeFenceRangedEdit(closed, { start: 5, end: 6 }, 'Z')).toBeNull();
		expect(computeFenceRangedEdit(closed, { start: 19, end: 19 }, 'x')).toBeNull();
		expect(computeFenceRangedEdit(closed, { start: 0, end: 3 }, '~~~')).toBeNull();
	});

	it('still edits the info string of a closed fence verbatim', () => {
		expect(computeFenceRangedEdit(closed, { start: 5, end: 5 }, 'x')).toEqual({
			newText: '```jsx\nconst x = 1\n```',
			newCursor: 6
		});
	});

	it('rewrites an unclosed fence’s marker run verbatim — nothing to orphan', () => {
		const unclosed = fencedCode('```js\nconst x\n', 'js', false);
		expect(computeFenceRangedEdit(unclosed, { start: 0, end: 3 }, '')).toEqual({
			newText: 'js\nconst x',
			newCursor: 0
		});
	});
});
