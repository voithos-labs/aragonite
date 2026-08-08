// @vitest-environment jsdom
//
// The widget-free walk carries the same hidden-run rule as the walk beside it: a span the
// mode paints nothing for holds no landable position, so a range never starts or ends in it.
// Miss-analysis: `content-offsets.test.ts` builds bare containers with no `data-presentation`
// root, so the atomic-widget rule was pinned and the hidden-run one had no fixture to fail in
// — a live-mode code block seated its caret inside the hidden opener fence unobserved.
import { describe, it, expect, afterEach } from 'vitest';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import { createRangeFromOffsets, setCursorOffset } from '../../cursor/content-offsets';
import { isHiddenMarkerText } from '../../cursor/widget-offset';

interface Fixture {
	block: HTMLElement;
	openerText: Text;
	body: Text;
}

/** A fenced code block's DOM: hidden opener line [0,6), body [6,19), hidden closer [19,22). */
function mount(mode?: string): Fixture {
	const root = document.createElement('div');
	root.className = 'editor';
	if (mode) root.setAttribute('data-presentation', mode);
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	const opener = fenceLine('```js', '\n');
	const body = document.createTextNode('const x = 1;\n');
	block.append(opener, body, fenceLine('```', ''));
	root.appendChild(block);
	document.body.appendChild(root);
	return { block, openerText: opener.firstChild!.firstChild as Text, body };
}

function fenceLine(marker: string, tail: string): HTMLElement {
	const line = document.createElement('span');
	line.className = 'md-fence-line';
	const span = document.createElement('span');
	span.className = 'md-marker md-fence';
	span.textContent = marker;
	line.append(span, document.createTextNode(tail));
	return line;
}

function caretNode(): Node {
	return window.getSelection()!.getRangeAt(0).startContainer;
}

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

describe('createRangeFromOffsets — hidden marker runs are opaque', () => {
	for (const offset of [0, 3, 6]) {
		it(`seats no endpoint in the hidden opener fence at offset ${offset}`, () => {
			const fx = mount('live');
			const range = createRangeFromOffsets(
				fx.block,
				asDomTextOffset(offset),
				asDomTextOffset(offset)
			)!;
			expect(isHiddenMarkerText(range.startContainer, fx.block)).toBe(false);
			expect(isHiddenMarkerText(range.endContainer, fx.block)).toBe(false);
		});
	}

	it('still resolves an exact position inside the visible body', () => {
		const fx = mount('live');
		const range = createRangeFromOffsets(fx.block, asDomTextOffset(8), asDomTextOffset(8))!;
		expect(range.startContainer).toBe(fx.body);
		expect(range.startOffset).toBe(2);
	});

	it('seats no endpoint in the hidden closer fence', () => {
		const fx = mount('live');
		const range = createRangeFromOffsets(fx.block, asDomTextOffset(21), asDomTextOffset(21))!;
		expect(isHiddenMarkerText(range.startContainer, fx.block)).toBe(false);
	});

	it('spans the whole block without descending into either fence', () => {
		const fx = mount('live');
		const range = createRangeFromOffsets(fx.block, asDomTextOffset(0), asDomTextOffset(22))!;
		expect(isHiddenMarkerText(range.startContainer, fx.block)).toBe(false);
		expect(isHiddenMarkerText(range.endContainer, fx.block)).toBe(false);
		expect(range.toString()).toContain('const x = 1;');
	});

	// Source mode paints the fences, so they are ordinary text the caret may enter.
	it('leaves source mode alone', () => {
		const fx = mount();
		const range = createRangeFromOffsets(fx.block, asDomTextOffset(3), asDomTextOffset(3))!;
		expect(range.startContainer).toBe(fx.openerText);
		expect(range.startOffset).toBe(3);
	});
});

describe('setCursorOffset — the corrupting landing', () => {
	it('never drops the caret inside the hidden opener fence', () => {
		const fx = mount('live');
		setCursorOffset(fx.block, asDomTextOffset(0));
		expect(isHiddenMarkerText(caretNode(), fx.block)).toBe(false);
	});

	it('drops it in the fence text in source mode, where the bytes are visible', () => {
		const fx = mount();
		setCursorOffset(fx.block, asDomTextOffset(0));
		expect(caretNode()).toBe(fx.openerText);
	});
});
