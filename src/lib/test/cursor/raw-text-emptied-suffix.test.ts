// @vitest-environment jsdom
// Miss-analysis: every read-back test kept some text, so none asked what an emptied block
// holding only its trailing structure reads as; the structure came back as the block's text.
import { describe, it, expect } from 'vitest';
import { BLOCK_SUFFIX_ATTR, rawTextOfContent } from '$lib/cursor/widget-offset';

/** A prose block's element from HTML, the way the browser leaves it after an edit. */
function block(html: string): HTMLElement {
	const el = document.createElement('div');
	el.innerHTML = html;
	return el;
}

const SUFFIX = `<span class="md-marker" ${BLOCK_SUFFIX_ATTR}=""> #</span>`;

describe('reading back a block whose text was emptied', () => {
	it('reads nothing when only the trailing structure is left', () => {
		expect(rawTextOfContent(block(SUFFIX), '# H #\n')).toBe('');
		expect(rawTextOfContent(block(`${SUFFIX}<br>`), '# H #\n')).toBe('');
	});

	it('keeps the structure while anything else is left, a marker included', () => {
		expect(rawTextOfContent(block(`<span class="md-marker"># </span>${SUFFIX}`), '# H #\n')).toBe(
			'#  #'
		);
		expect(rawTextOfContent(block(`H${SUFFIX}x`), '# H #\n')).toBe('H #x');
	});
});
