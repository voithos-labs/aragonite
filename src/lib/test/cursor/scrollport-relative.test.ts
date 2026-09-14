import { describe, it, expect } from 'vitest';
import { withRelativeScroll, type Scrollport } from '../../cursor/scrollport';

/** A scroller with a real one's two refusals: it rounds every write to a whole pixel, and
 *  clamps at both ends. */
function snappingScroller(
	max = Infinity
): Omit<Scrollport, 'scrollBy'> & { jumpTo(value: number): void } {
	let top = 0;
	return {
		viewportTop: () => 0,
		viewportHeight: () => 500,
		contentWidth: () => 800,
		scrollTop: () => top,
		setScrollTop: (value) => {
			top = Math.round(Math.max(0, Math.min(value, max)));
		},
		jumpTo: (value: number) => {
			top = value;
		},
		subscribe: () => () => {}
	};
}

describe('a relative scroll write over a snapping scroller', () => {
	it('carries the refused fraction into the next move', () => {
		const port = withRelativeScroll(snappingScroller());
		for (let i = 0; i < 3; i++) port.scrollBy(10.4);
		expect(port.scrollTop()).toBe(31);
	});

	it('drops the carry once something else has moved the port', () => {
		const base = snappingScroller();
		const port = withRelativeScroll(base);
		port.scrollBy(10.4); // lands at 10, one refused 0.4 in hand
		base.jumpTo(200); // the reader scrolls
		port.scrollBy(10.4);
		expect(port.scrollTop()).toBe(210);
	});

	it('drops the carry when the scroller clamps rather than snaps', () => {
		const port = withRelativeScroll(snappingScroller(100));
		port.scrollBy(500);
		port.scrollBy(-10.4);
		expect(port.scrollTop()).toBe(90);
	});

	it('drops the carry on an absolute write, which names its own position', () => {
		const port = withRelativeScroll(snappingScroller());
		port.scrollBy(10.4);
		port.setScrollTop(50);
		port.scrollBy(10.4);
		expect(port.scrollTop()).toBe(60);
	});
});
