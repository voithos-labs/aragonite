import { describe, it, expect } from 'vitest';
import { keepEqualParts, splitBucket } from '#lib/decorations/block-paint.js';
import type { Decoration } from '#lib/decorations/types.js';
import { stubWidget, mark, widget } from './fixtures/decorations';

describe('a block keeps the paint it held while equal', () => {
	it('keeps the held arrays, and the held paint, when every part is equal', () => {
		const held = splitBucket([mark([0]), { type: 'block', path: [0], class: 'b' }]);
		const next = splitBucket([mark([0]), { type: 'block', path: [0], class: 'b' }]);
		expect(keepEqualParts(held, next)).toBe(held);
	});

	it('takes the new marks when one moved, keeping the equal block part', () => {
		const held = splitBucket([mark([0]), { type: 'block', path: [0], class: 'b' }]);
		const moved = { ...mark([0]), start: 1, end: 2 } as (typeof held.marks)[number]['dec'];
		const kept = keepEqualParts(
			held,
			splitBucket([moved, { type: 'block', path: [0], class: 'b' }])
		);
		expect([kept.marks === held.marks, kept.blocks === held.blocks]).toEqual([false, true]);
	});

	it('never keeps a widget or a badge, whose view is told each new decoration', () => {
		const badge: Decoration = { type: 'block', path: [0], badge: stubWidget };
		const held = splitBucket([widget([0], 1), badge]);
		const kept = keepEqualParts(held, splitBucket([widget([0], 1), { ...badge }]));
		expect([kept.islands === held.islands, kept.blocks === held.blocks]).toEqual([false, false]);
	});
});
