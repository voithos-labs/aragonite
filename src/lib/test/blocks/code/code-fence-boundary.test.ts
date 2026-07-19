import { describe, it, expect } from 'vitest';
import {
	classifyFenceBoundary,
	clampEnterOffsetToBody
} from '../../../components/blocks/code/code-fence-boundary';
import { computeCodeEnter } from '../../../components/blocks/code/code-enter';
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
