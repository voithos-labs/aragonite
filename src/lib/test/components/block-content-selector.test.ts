// @vitest-environment jsdom
//
// Both selectors are read against BlockHost's real wrapper layout. The locator
// form enumerates ALL matches, so every chrome child it fails to name inflates the
// per-block count — and `.decoration-overlay` is emitted once per painted mark,
// which made the inflation vary with the live decoration set rather than being a
// constant a spec could absorb.
import { describe, it, expect } from 'vitest';
import {
	BLOCK_CONTENT_SELECTOR,
	BLOCK_CONTENT_LOCATOR_SELECTOR
} from '$lib/components/block-content-selector';

/** BlockHost's wrapper children, in the order the component renders them. */
function blockWrapper(options: { badges?: number; marks?: number; handle?: boolean }): HTMLElement {
	const wrapper = document.createElement('div');
	wrapper.setAttribute('data-block-path', '[0]');

	for (let i = 0; i < (options.badges ?? 0); i++) {
		wrapper.appendChild(
			Object.assign(document.createElement('div'), { className: 'decoration-badge' })
		);
	}
	wrapper.appendChild(Object.assign(document.createElement('p'), { className: 'md-block' }));
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
	['with several painted marks', { badges: 1, marks: 3, handle: true }]
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
