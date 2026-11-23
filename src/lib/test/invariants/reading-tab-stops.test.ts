// @vitest-environment jsdom
// Miss-analysis: every block that kept an editable element in reading mode kept it shown, so no
// row held a drawn block's hidden text element, which takes no focus, against the check.
import { describe, expect, it } from 'vitest';
import { checkReadingTabStops } from '#lib/invariants/reading-tab-stops.js';

function rootWith(html: string): HTMLElement {
	const root = document.createElement('div');
	root.innerHTML = html;
	return root;
}

describe('the reading-mode tab stop check', () => {
	it('fails a second editable element in the tab order', () => {
		const root = rootWith('<div tabindex="0"></div><div contenteditable="true"></div>');
		expect(checkReadingTabStops(root)?.code).toBe('reading-tab-stops');
	});

	it('passes one a hidden element holds', () => {
		const root = rootWith(
			'<div tabindex="0"></div><div><div hidden><div contenteditable="true"></div></div></div>'
		);
		expect(checkReadingTabStops(root)).toBeNull();
	});
});
