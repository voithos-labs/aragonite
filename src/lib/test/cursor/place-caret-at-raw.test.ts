// @vitest-environment jsdom
//
// The one caret writer and the one reader: a raw offset lands past the marker prefix and, when
// asked to, onto a position the caret can reach; a DOM position reads back through the same
// prefix length, taken from the DOM.
import { describe, it, expect, afterEach } from 'vitest';
import { buildAmbientSpan } from '../../ambient/ambient-dom';
import {
	placeCaretAtRaw,
	rawOffsetAt,
	rawSelectionFocus,
	selectRawRange,
	selectSurfaceContent
} from '../../cursor/widget-offset';

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

/** `**bold**` under `mode`, optionally behind a list item's `- ` prefix. */
function mount(mode: string, prefix?: string) {
	const root = document.createElement('div');
	root.setAttribute('data-presentation', mode);
	const block = document.createElement('div');
	block.setAttribute('contenteditable', 'true');
	if (prefix) block.appendChild(buildAmbientSpan(prefix));
	const open = marker('**');
	const body = document.createTextNode('bold');
	block.append(open, body, marker('**'));
	root.appendChild(block);
	document.body.appendChild(root);
	return { block, open: open.firstChild as Text, body };
}

function marker(text: string): HTMLElement {
	const span = document.createElement('span');
	span.className = 'md-marker';
	span.textContent = text;
	return span;
}

/** The caret as text, since diffing a DOM node prints the whole window. */
function caretAt(): string {
	const sel = window.getSelection()!;
	const node = sel.focusNode!;
	const name = node.nodeType === Node.TEXT_NODE ? JSON.stringify(node.textContent) : 'element';
	return `${name}@${sel.focusOffset}`;
}

describe('placeCaretAtRaw', () => {
	it('reachable moves raw 0 past a leading hidden run onto painted text', () => {
		const { block } = mount('live');
		placeCaretAtRaw(block, 0, { clamp: 'reachable' });
		expect(caretAt()).toBe('"bold"@0');
	});

	it('exact keeps raw 0 before the hidden run', () => {
		const { block } = mount('live');
		placeCaretAtRaw(block, 0, { clamp: 'exact' });
		expect(caretAt()).toBe('element@0');
	});

	it('raw 0 behind a marker prefix lands after the prefix span, never inside it', () => {
		const { block } = mount('source', '- ');
		placeCaretAtRaw(block, 0, { clamp: 'exact' });
		expect(caretAt()).toBe('"**"@0');
	});
});

describe('rawOffsetAt', () => {
	it('subtracts the prefix read off the DOM', () => {
		const { block, body } = mount('source', '- ');
		expect(rawOffsetAt(block, body, 1)).toBe(3);
	});

	it('reads a position inside the prefix as raw 0', () => {
		const { block } = mount('source', '- ');
		expect(rawOffsetAt(block, block.firstChild!.firstChild!, 1)).toBe(0);
	});
});

// Miss-analysis: every caller of the focus read held a collapsed caret, where anchor and focus
// are one position, so reading the anchor instead passed the whole unit suite.
describe('rawSelectionFocus', () => {
	it('reads the moving end of a backward range, not its anchor', () => {
		const { block } = mount('source', '- ');
		selectRawRange(block, 5, 3);
		expect(rawSelectionFocus(block)).toBe(3);
	});
});

describe('range writers', () => {
	it('selectRawRange writes a backward range with the focus first', () => {
		const { block } = mount('source');
		selectRawRange(block, 5, 3);
		const sel = window.getSelection()!;
		expect([sel.anchorOffset, sel.focusOffset]).toEqual([3, 1]);
	});

	it('selectSurfaceContent starts past the prefix and ends at the content end', () => {
		const { block } = mount('source', '- ');
		selectSurfaceContent(block);
		expect(window.getSelection()!.toString()).toBe('**bold**');
	});

	it('selectSurfaceContent selects past the prefix of a block holding only widgets', () => {
		const root = document.createElement('div');
		const block = document.createElement('div');
		block.setAttribute('contenteditable', 'true');
		const image = (start: number, end: number): HTMLElement => {
			const w = document.createElement('span');
			w.setAttribute('data-inline-widget', '');
			w.setAttribute('contenteditable', 'false');
			w.setAttribute('data-source-start', String(start));
			w.setAttribute('data-source-end', String(end));
			w.appendChild(document.createElement('img'));
			return w;
		};
		block.append(buildAmbientSpan('- '), image(0, 7), image(7, 14));
		root.appendChild(block);
		document.body.appendChild(root);
		selectSurfaceContent(block);
		const range = window.getSelection()!.getRangeAt(0);
		expect(rawOffsetAt(block, range.startContainer, range.startOffset)).toBe(0);
		expect(rawOffsetAt(block, range.endContainer, range.endOffset)).toBe(14);
		// Right after the marker span, so the marker itself is not in the selection.
		expect(range.startContainer === block && range.startOffset).toBe(1);
	});
});
