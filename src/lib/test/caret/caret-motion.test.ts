// Miss-analysis: every caret key was the browser's past a span, so no row asked where a word or a
// line edge lands, and each engine's own answer reached the user.
import { describe, expect, it } from 'vitest';
import { motionTarget, type CaretUnitSource, type MotionIntent } from '#lib/caret/caret-motion.js';
import type { DeleteContext } from '#lib/caret/delete-extent.js';

const NO_SPANS: CaretUnitSource = { beside: () => null, crossed: () => {} };

function at(
	text: string,
	caret: number,
	extra: Partial<DeleteContext> = {}
): (intent: MotionIntent) => number | null {
	const block: DeleteContext = { text, caret, bounds: { start: 0, end: text.length }, ...extra };
	return (intent) => motionTarget(intent, { caret, units: NO_SPANS, extending: false, block });
}

const back = (unit: MotionIntent['unit']): MotionIntent => ({ unit, direction: 'backward' });
const forth = (unit: MotionIntent['unit']): MotionIntent => ({ unit, direction: 'forward' });

describe('motionTarget', () => {
	it('lands a word where the word delete ends', () => {
		const move = at('foo.bar, baz-qux end', 20);
		expect(move(back('word'))).toBe(17);
		expect(at('foo.bar, baz-qux end', 0)(forth('word'))).toBe(3);
	});

	it('steps one character across a line break, as the word delete takes it', () => {
		expect(at('abc\r\nghi', 5)(back('word'))).toBe(3);
		expect(at('abc\nghi', 3)(forth('word'))).toBe(4);
	});

	it('names nothing at the bound a word key faces, so the boundary step decides', () => {
		expect(at('abc', 0)(back('word'))).toBeNull();
		expect(at('abc', 3)(forth('word'))).toBeNull();
	});

	it('lands a line edge where the block reads it, kept inside the reachable bounds', () => {
		const lineEdge = (side: 'start' | 'end') => (side === 'start' ? -2 : 9);
		const move = at('- abc', 3, { bounds: { start: 0, end: 3 }, lineEdge });
		expect(move(back('line-edge'))).toBe(0);
		expect(move(forth('line-edge'))).toBe(3);
	});

	it('names nothing for a line nothing lays out', () => {
		expect(at('abc', 1, { lineEdge: () => null })(back('line-edge'))).toBeNull();
	});

	it('lands a block edge on the reachable bounds', () => {
		const move = at('**bold**', 4, { bounds: { start: 2, end: 6 } });
		expect(move(back('block-edge'))).toBe(2);
		expect(move(forth('block-edge'))).toBe(6);
	});

	it('crosses a span whole, and names nothing with no span beside the caret', () => {
		const units: CaretUnitSource = {
			beside: (offset, direction) =>
				offset === 1 && direction === 'forward' ? { start: 1, end: 7 } : null,
			crossed: () => {}
		};
		const ctx = { caret: 1, units, extending: false, block: null };
		expect(motionTarget(forth('character'), ctx)).toBe(7);
		expect(motionTarget(back('character'), ctx)).toBeNull();
	});

	it('declines every unit but a character without the block’s context', () => {
		const ctx = { caret: 1, units: NO_SPANS, extending: false, block: null };
		for (const unit of ['word', 'line-edge', 'block-edge'] as const) {
			expect(motionTarget(back(unit), ctx), unit).toBeNull();
		}
	});
});
