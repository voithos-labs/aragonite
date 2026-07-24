import { describe, it, expect } from 'vitest';
import {
	classifyFenceBoundary,
	clampEnterOffsetToBody,
	clampRangeToBody
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
			mode: 'normal'
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
