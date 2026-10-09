// One editor's answer to whether a click follows: a pointer click that travelled past the drag
// threshold from its own press is a drag's release, whatever the selection held before the press.
// Miss-analysis: the rule read "the block holds a range" as a drag, and no test clicked a widget
// with a range left over from before the press, which the press keeps.
import { describe, it, expect } from 'vitest';
import { bindActivationClick, createPressTracker, DRAG_SLOP_PX } from '#lib/activation-click.js';

const follows = () => {
	const presses = createPressTracker();
	return {
		presses,
		follows: bindActivationClick(
			() => 'reading',
			() => 'modifier',
			presses
		)
	};
};

describe('bindActivationClick', () => {
	it('declines a pointer click that landed past the drag threshold from its press', () => {
		const { presses, follows: rule } = follows();
		presses.press({ clientX: 10, clientY: 10 });

		expect(rule({ ctrlKey: false, metaKey: false, detail: 1, clientX: 10, clientY: 10 })).toBe(
			true
		);
		const far = 10 + DRAG_SLOP_PX + 1;
		expect(rule({ ctrlKey: false, metaKey: false, detail: 1, clientX: far, clientY: 10 })).toBe(
			false
		);
	});

	it('never asks about travel for a keyboard click or a synthetic one', () => {
		const { presses, follows: rule } = follows();
		presses.press({ clientX: 10, clientY: 10 });

		expect(rule({ ctrlKey: false, metaKey: false, detail: 0, clientX: 0, clientY: 0 })).toBe(true);
		expect(rule({ ctrlKey: false, metaKey: false })).toBe(true);
	});

	it('declines the later presses of a multi-click', () => {
		const { follows: rule } = follows();
		expect(rule({ ctrlKey: false, metaKey: false, detail: 2 })).toBe(false);
	});
});
