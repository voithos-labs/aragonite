// @vitest-environment jsdom
//
// A code block's fence lines under a mode that hides them are nowhere the caret can sit, so a
// range from raw offsets never starts or ends in one, and a caret write never lands in one.
// Miss-analysis: the plain-text walk's suite built bare containers with no `data-presentation`
// root, so the hidden-run rule had no fixture to fail in, and a live-mode code block put its caret
// inside the hidden opener fence unobserved.
import { describe, it, expect, afterEach } from 'vitest';
import {
	isHiddenMarkerText,
	placeCaretAtRaw,
	rawRangeToDomRange
} from '../../cursor/widget-offset';

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

describe('rawRangeToDomRange: hidden fence lines are opaque', () => {
	for (const offset of [0, 3, 6]) {
		it(`puts the caret no endpoint in the hidden opener fence at offset ${offset}`, () => {
			const fx = mount('live');
			const range = rawRangeToDomRange(fx.block, offset, offset)!;
			expect(isHiddenMarkerText(range.startContainer, fx.block)).toBe(false);
			expect(isHiddenMarkerText(range.endContainer, fx.block)).toBe(false);
		});
	}

	it('still resolves an exact position inside the visible body', () => {
		const fx = mount('live');
		const range = rawRangeToDomRange(fx.block, 8, 8)!;
		expect(range.startContainer).toBe(fx.body);
		expect(range.startOffset).toBe(2);
	});

	it('puts the caret no endpoint in the hidden closer fence', () => {
		const fx = mount('live');
		const range = rawRangeToDomRange(fx.block, 21, 21)!;
		expect(isHiddenMarkerText(range.startContainer, fx.block)).toBe(false);
	});

	it('spans the whole block without descending into either fence', () => {
		const fx = mount('live');
		const range = rawRangeToDomRange(fx.block, 0, 22)!;
		expect(isHiddenMarkerText(range.startContainer, fx.block)).toBe(false);
		expect(isHiddenMarkerText(range.endContainer, fx.block)).toBe(false);
		expect(range.toString()).toContain('const x = 1;');
	});

	// Source mode paints the fences, so they are ordinary text the caret may enter.
	it('leaves source mode alone', () => {
		const fx = mount();
		const range = rawRangeToDomRange(fx.block, 3, 3)!;
		expect(range.startContainer).toBe(fx.openerText);
		expect(range.startOffset).toBe(3);
	});
});

describe('placeCaretAtRaw: the corrupting landing', () => {
	it('never drops the caret inside the hidden opener fence', () => {
		const fx = mount('live');
		placeCaretAtRaw(fx.block, 0, { clamp: 'exact' });
		expect(isHiddenMarkerText(caretNode(), fx.block)).toBe(false);
	});

	it('drops it in the fence text in source mode, where the bytes are visible', () => {
		const fx = mount();
		placeCaretAtRaw(fx.block, 0, { clamp: 'exact' });
		expect(caretNode()).toBe(fx.openerText);
	});
});
