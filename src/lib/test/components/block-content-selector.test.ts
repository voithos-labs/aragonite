// @vitest-environment jsdom
//
// Read against BlockHost's real wrapper layout: the locator form enumerates ALL
// matches, so an unnamed chrome child inflates the per-block count — and one of them
// (`.decoration-overlay`) varies with the live decoration set.
import { describe, it, expect } from 'vitest';
import {
	BLOCK_CONTENT_SELECTOR,
	BLOCK_CONTENT_LOCATOR_SELECTOR
} from '$lib/components/block-content-selector';

/** BlockHost's wrapper children, in the order the component renders them. */
function blockWrapper(options: {
	badges?: number;
	marks?: number;
	handle?: boolean;
	langChip?: boolean;
}): HTMLElement {
	const wrapper = document.createElement('div');
	wrapper.setAttribute('data-block-path', '[0]');

	for (let i = 0; i < (options.badges ?? 0); i++) {
		wrapper.appendChild(
			Object.assign(document.createElement('div'), { className: 'decoration-badge' })
		);
	}
	wrapper.appendChild(Object.assign(document.createElement('p'), { className: 'md-block' }));
	// The code surface's own chrome, rendered by the block component rather than by the host.
	if (options.langChip) {
		wrapper.appendChild(
			Object.assign(document.createElement('span'), { className: 'code-lang-chip' })
		);
	}
	wrapper.appendChild(
		Object.assign(document.createElement('div'), { className: 'selection-overlay' })
	);
	for (let i = 0; i < (options.marks ?? 0); i++) {
		wrapper.appendChild(
			Object.assign(document.createElement('div'), { className: 'decoration-overlay md-mark' })
		);
	}
	if (options.handle) {
		wrapper.appendChild(
			Object.assign(document.createElement('div'), { className: 'block-drag-handle' })
		);
	}
	return wrapper;
}

const LAYOUTS = [
	['bare', {}],
	['with a drag handle', { handle: true }],
	['with badges', { badges: 2, handle: true }],
	['with one painted mark', { marks: 1, handle: true }],
	['with several painted marks', { badges: 1, marks: 3, handle: true }],
	['with a code language chip', { langChip: true, handle: true }],
	['with a chip beside every other chrome', { badges: 1, marks: 2, langChip: true, handle: true }]
] as const;

describe('BLOCK_CONTENT_LOCATOR_SELECTOR resolves exactly one element per block', () => {
	it.each(LAYOUTS)('%s', (_label, options) => {
		const wrapper = blockWrapper(options);
		const matches = wrapper.querySelectorAll(BLOCK_CONTENT_LOCATOR_SELECTOR);

		expect(matches).toHaveLength(1);
		expect(matches[0].className).toBe('md-block');
	});
});

describe('BLOCK_CONTENT_SELECTOR resolves the content by first match', () => {
	it.each(LAYOUTS)('%s', (_label, options) => {
		const wrapper = blockWrapper(options);

		expect(wrapper.querySelector(BLOCK_CONTENT_SELECTOR)?.className).toBe('md-block');
	});
});
