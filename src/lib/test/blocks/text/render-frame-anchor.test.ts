// @vitest-environment jsdom
// A picture ending a block's content leaves a caret anchor after it, so its line holds a
// text-height box for the bar beside the picture to stand at; the anchor adds no byte to any read.
// Miss-analysis: a picture laid out as a block had no line to anchor, so no test ever asked what
// sits after a picture that ends its block.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseInline } from '#lib/core/inline/index.js';
import { renderInlineNodes, type RenderInlineOptions } from '#lib/core/inline-render.js';
import { FRAME_ATTR } from '#lib/core/inline/widget-shell.js';
import { buildImageWidget } from '#lib/components/image/widget-dom.js';
import { renderOptions } from '../../harness/fixture-grammar';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	selectRange,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { rawTextOfContent } from '#lib/browser/block-text.js';
import { caretPointAtRaw, endOfContents } from '#lib/browser/offsets.js';
import { placeholderBreakOf } from '#lib/browser/placeholder-break.js';
import { shownSelectionText } from '#lib/browser/selection-read.js';

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	vi.restoreAllMocks();
	document.body.innerHTML = '';
});

const IMG = '![x](i.png)';

function render(raw: string, opts: Partial<RenderInlineOptions> = {}): DocumentFragment {
	const brokenUrlCache = new Set<string>();
	return renderInlineNodes(
		parseInline(raw, 0, raw.length),
		raw,
		renderOptions({
			buildImageWidget: (node, src, imgOpts) =>
				buildImageWidget(node, src, { ...imgOpts, brokenUrlCache }),
			...opts
		})
	);
}

const frameAnchors = (root: ParentNode) =>
	root.querySelectorAll('br[data-caret-anchor="frame"]').length;

const endsOnAnchor = (root: ParentNode) => {
	const last = root.lastChild;
	return last instanceof HTMLBRElement && last.dataset.caretAnchor === 'frame';
};

describe('the render', () => {
	it.each([
		['a lone picture', IMG],
		['a picture in a link, past its markers', `[${IMG}](https://x.y)`],
		['a picture in emphasis', `*${IMG}*`],
		['text, then a picture', `lead ${IMG}`]
	])('anchors the line after %s', (_, raw) => {
		const frag = render(raw);
		expect(frag.querySelector(`[${FRAME_ATTR}]`)).not.toBeNull();
		expect(frameAnchors(frag)).toBe(1);
		expect(endsOnAnchor(frag)).toBe(true);
		expect(frag.textContent).toBe(render(raw).textContent);
	});

	it.each([
		['text after the picture', `${IMG} tail`],
		['a widget that declares no frame', 'a &copy;'],
		['a picture drawn as its source', IMG, { renderImagesAsWidgets: false }],
		['a pending break, whose own anchors end the line', IMG, { pendingBreaks: 1 }]
	] as const)('leaves no anchor after %s', (_, raw, opts: Partial<RenderInlineOptions> = {}) => {
		expect(frameAnchors(render(raw, opts))).toBe(0);
	});

	it('stamps only the widgets whose kind declares a frame', () => {
		const frag = render(`a &copy; ${IMG}`);
		expect(frag.querySelector('.md-entity-widget')?.hasAttribute(FRAME_ATTR)).toBe(false);
		expect(frag.querySelector('[data-image-widget]')?.hasAttribute(FRAME_ATTR)).toBe(true);
	});
});

/** The block's top-level children in order: text, the suffix span, an anchor, a widget. */
function shape(el: HTMLElement): string[] {
	return [...el.childNodes].map((node) => {
		if (node instanceof HTMLBRElement) return `<br ${node.dataset.caretAnchor ?? ''}>`;
		if (node instanceof HTMLElement && node.hasAttribute('data-block-suffix')) {
			return `suffix:${node.textContent}`;
		}
		if (node instanceof HTMLElement && node.hasAttribute('data-inline-widget')) return 'widget';
		return node.textContent ?? '';
	});
}

describe.each(['source', 'live'] as const)('%s mode: a block ending on a picture', (mode) => {
	it('puts a setext underline before the anchor, so source mode draws no blank line', () => {
		const editor = mountEditor({ source: `${IMG}\n===\n`, presentationMode: mode });
		expect(shape(surfaceAt(editor, [0])).slice(-2)).toEqual(['suffix:\n===', '<br frame>']);
	});

	it('puts a closing run before the anchor, on the picture’s line', () => {
		const editor = mountEditor({ source: `## ${IMG} ##\n`, presentationMode: mode });
		expect(shape(surfaceAt(editor, [0])).slice(-2)).toEqual(['suffix: ##', '<br frame>']);
	});
});

describe('every read skips the anchor', () => {
	it('reads the block back as its bytes', () => {
		for (const source of [IMG, `[${IMG}](https://x.y)`, `lead ${IMG}`]) {
			const el = surfaceAt(mountEditor({ source: `${source}\n`, presentationMode: 'live' }), [0]);
			expect(endsOnAnchor(el)).toBe(true);
			expect(rawTextOfContent(el, source, '')).toBe(source);
		}
	});

	it('puts the caret at the picture’s end, and the content’s end, before the anchor', () => {
		const el = surfaceAt(mountEditor({ source: `lead ${IMG}\n`, presentationMode: 'live' }), [0]);
		const anchorAt = [...el.childNodes].indexOf(el.lastChild as ChildNode);
		expect(caretPointAtRaw(el, `lead ${IMG}`.length)).toEqual({ node: el, offset: anchorAt });
		expect(endOfContents(el)).toEqual({ node: el, offset: anchorAt });
		expect(placeholderBreakOf(el)).toBe(el.lastChild);
	});

	it('leaves the anchor out of the text a selection of the block reads', () => {
		const el = surfaceAt(mountEditor({ source: `${IMG}\n`, presentationMode: 'live' }), [0]);
		const range = document.createRange();
		range.selectNodeContents(el);
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(range);
		// What a browser's selection string holds for a selected `<br>`, which jsdom leaves out.
		vi.spyOn(Selection.prototype, 'toString').mockReturnValue('\n');
		expect(shownSelectionText()).toBe('');
	});

	it('copies a picture paragraph as its bytes, with no html for the anchor to leak into', () => {
		const editor = mountEditor({ source: `${IMG}\n`, presentationMode: 'live' });
		const el = surfaceAt(editor, [0]);
		selectRange(el, 0, IMG.length);
		const store = new Map<string, string>();
		const e = new Event('copy', { bubbles: true, cancelable: true });
		Object.defineProperty(e, 'clipboardData', {
			value: { setData: (t: string, v: string) => void store.set(t, v), getData: () => '' }
		});
		el.dispatchEvent(e);
		expect(store.get('text/plain')).toBe(IMG);
		expect(store.has('text/html')).toBe(false);
		expect(e.defaultPrevented).toBe(true);
	});
});
