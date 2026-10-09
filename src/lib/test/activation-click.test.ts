// @vitest-environment jsdom
// One editor's answer to whether a click follows: a click that ends holding a range is a drag's
// release, and a synthetic click (the cursor's reads) never asks about the selection.
// Miss-analysis: the rule took the keys and the mode but not whether the click was a click, so a
// drag inside a link followed it; no test released a drag on one.
import { describe, it, expect } from 'vitest';
import { bindActivationClick } from '#lib/activation-click.js';

describe('bindActivationClick', () => {
	it('declines a click that ends holding a range, and asks only about a real click', () => {
		const asked: EventTarget[] = [];
		const follows = bindActivationClick(
			() => 'reading',
			() => 'modifier',
			(target) => {
				asked.push(target);
				return true;
			}
		);
		const target = document.createElement('a');

		expect(follows({ ctrlKey: false, metaKey: false })).toBe(true);
		expect(asked).toEqual([]);
		expect(follows({ ctrlKey: false, metaKey: false, detail: 1, target })).toBe(false);
		expect(asked).toEqual([target]);
	});
});
