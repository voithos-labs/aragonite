// @vitest-environment jsdom
//
// Every editable surface reads and writes the caret through the same offset walk as a live
// caret in prose: a widget counts its source bytes, and adjacent hidden spans are one run.
// Miss-analysis: the plain-text backend had its own walk, tested only on containers with no
// widget and one hidden span at a time, so its two disagreements with the shared walk had no
// fixture to fail in (#498, #572).
import { describe, it, expect, afterEach } from 'vitest';
import { asRawOffset } from '../../cursor/coordinate-spaces';
import { createSurfaceBackend } from '../../cursor/surface-backend';

afterEach(() => {
	document.body.replaceChildren();
	window.getSelection()?.removeAllRanges();
});

/** A focused editable surface under an editor root in `mode` (source when omitted). */
function surface(mode?: string): HTMLElement {
	const root = document.createElement('div');
	if (mode) root.setAttribute('data-presentation', mode);
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	el.tabIndex = 0;
	root.appendChild(el);
	document.body.appendChild(root);
	return el;
}

/** An atomic widget standing for raw [start, end) whose text is one glyph, not its bytes. */
function widget(start: number, end: number): HTMLElement {
	const w = document.createElement('span');
	w.setAttribute('data-inline-widget', '');
	w.setAttribute('contenteditable', 'false');
	w.setAttribute('data-source-start', String(start));
	w.setAttribute('data-source-end', String(end));
	w.textContent = '©';
	return w;
}

function fenceLine(text: string): HTMLElement {
	const line = document.createElement('span');
	line.className = 'md-fence-line';
	line.textContent = text;
	return line;
}

function caret(): { node: Node; offset: number } {
	const range = window.getSelection()!.getRangeAt(0);
	return { node: range.startContainer, offset: range.startOffset };
}

describe('the surface backend counts a widget by its source bytes', () => {
	// "ab", a widget for raw [2, 8), "cd": raw 7 is inside the widget, raw 9 is inside "cd".
	function mountWithWidget(): { el: HTMLElement; tail: Text } {
		const el = surface();
		const tail = document.createTextNode('cd');
		el.append(document.createTextNode('ab'), widget(2, 8), tail);
		el.focus();
		return { el, tail };
	}

	it('writes a raw offset past the widget into the text after it', () => {
		const { el } = mountWithWidget();
		createSurfaceBackend({ getEl: () => el }).setRaw(asRawOffset(9), { clamp: 'exact' });
		const { node, offset } = caret();
		expect(node.textContent).toBe('cd');
		expect(offset).toBe(1);
	});

	it('reads a caret past the widget back as the same raw offset', () => {
		const { el, tail } = mountWithWidget();
		window.getSelection()!.collapse(tail, 1);
		expect(createSurfaceBackend({ getEl: () => el }).getRaw()).toBe(9);
	});
});

describe('the surface backend treats adjacent hidden fence lines as one run (#572)', () => {
	it('never parks the caret between the two hidden lines of an empty fence', () => {
		const el = surface('live');
		const opener = fenceLine('```\n');
		const closer = fenceLine('```');
		el.append(opener, closer);
		el.focus();
		createSurfaceBackend({ getEl: () => el }).setRaw(asRawOffset(4), { clamp: 'exact' });
		const { node, offset } = caret();
		const between =
			node === el && el.childNodes[offset - 1] === opener && el.childNodes[offset] === closer;
		expect(between).toBe(false);
	});
});
