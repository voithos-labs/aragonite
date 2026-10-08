// @vitest-environment jsdom
// Miss-analysis: every read-back test kept some text, never only the trailing structure.
import { describe, it, expect } from 'vitest';
import {
	BLOCK_PREFIX_ATTR,
	BLOCK_SUFFIX_ATTR,
	landableRawBounds,
	rawTextOfContent
} from '#lib/cursor/widget-offset.js';

/** A prose block's element from HTML, the way the browser leaves it after an edit. */
function block(html: string): HTMLElement {
	const el = document.createElement('div');
	el.innerHTML = html;
	return el;
}

/** The same, inside a live-mode editor, where the block's markers hide. */
function live(html: string): HTMLElement {
	const root = document.createElement('div');
	root.setAttribute('data-presentation', 'live');
	const el = block(html);
	root.appendChild(el);
	return el;
}

const SUFFIX = `<span class="md-marker" ${BLOCK_SUFFIX_ATTR}=""> #</span>`;
const SETEXT = `<span class="md-marker" ${BLOCK_SUFFIX_ATTR}="">\n===</span>`;

describe('reading back a block whose text was emptied', () => {
	it('reads nothing when only the trailing structure is left', () => {
		expect(rawTextOfContent(block(SUFFIX), '# H #\n', ' #')).toBe('');
		expect(rawTextOfContent(block(`${SUFFIX}<br>`), '# H #\n', ' #')).toBe('');
	});

	it('keeps the structure while anything else is left, a marker included', () => {
		expect(
			rawTextOfContent(block(`<span class="md-marker"># </span>${SUFFIX}`), '# H #\n', ' #')
		).toBe('#  #');
		expect(rawTextOfContent(block(`H${SUFFIX}x`), '# H #\n', ' #')).toBe('H #x');
	});
});

// Miss-analysis: no row replaced the whole text with a key, which drops the `# ` span.
describe('reading back a heading whose `#` marker the browser dropped', () => {
	const RUN = `<span class="md-marker" ${BLOCK_SUFFIX_ATTR}="after-prefix"> #</span>`;
	const HASH = `<span class="md-marker" ${BLOCK_PREFIX_ATTR}=""># </span>`;

	it('drops the closing run with it where the marker was hidden', () => {
		expect(rawTextOfContent(live(` ${RUN}`), '# Hi #\n', ' #')).toBe(' ');
		expect(rawTextOfContent(live(`x${RUN}`), '# Hi #\n', ' #')).toBe('x');
	});

	// Miss-analysis: the dropped-marker rows hid markers, so none deleted a shown `# ` alone.
	it('keeps a shown run when only the shown marker went', () => {
		expect(rawTextOfContent(block(`Hi${RUN}`), '# Hi #\n', ' #')).toBe('Hi #');
	});

	it('keeps the run while the marker is there', () => {
		expect(rawTextOfContent(block(`${HASH}x${RUN}`), '# Hi #\n', ' #')).toBe('# x #');
		expect(rawTextOfContent(block(`${HASH}${RUN}`), '# Hi #\n', ' #')).toBe('#  #');
	});

	it('keeps a setext underline, which follows no marker span', () => {
		expect(rawTextOfContent(block(`x${SETEXT}`), 'Hi\n===\n', '\n===')).toBe('x\n===');
	});
});

// Miss-analysis: no row drew the typed text inside the structure span, where the browser puts it.
describe('reading back a key the browser wrote into the structure span', () => {
	const typedRun = `<span class="md-marker" ${BLOCK_SUFFIX_ATTR}="after-prefix">x #</span>`;

	it('reads the key as text and the rest as the structure', () => {
		expect(rawTextOfContent(live(typedRun), '# Hi #\n', ' #')).toBe('x');
		expect(rawTextOfContent(block(typedRun), '# Hi #\n', ' #')).toBe('x #');
		const typedUnderline = `<span class="md-marker" ${BLOCK_SUFFIX_ATTR}="">x\n===</span>`;
		expect(rawTextOfContent(block(typedUnderline), 'Hi\n===\n', '\n===')).toBe('x\n===');
	});
});

// Miss-analysis: no bounds test drew a block with no text between two hidden runs.
describe('where a caret can sit in an emptied heading with a closing run', () => {
	it('is between the marker and the run', () => {
		const root = document.createElement('div');
		root.setAttribute('data-presentation', 'live');
		const el = block(
			`<span class="md-marker" ${BLOCK_PREFIX_ATTR}=""># </span>` +
				`<span class="md-marker" ${BLOCK_SUFFIX_ATTR}="after-prefix"> #</span>`
		);
		root.appendChild(el);
		expect(landableRawBounds(el)).toEqual({ start: 2, end: 2 });
	});
});
