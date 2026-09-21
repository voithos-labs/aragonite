// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import { createSourceReveal } from '../../cursor/reveal-source';
import {
	createRangeAtDomTextOffsets,
	findDomTextOffsetTarget,
	domTextOffsetAtNode,
	rawTextOfNode
} from '../../cursor/widget-offset';

// Fixture: the paragraph "a $x^2$ b", whose $…$ math renders as one widget the caret cannot
// enter. Offsets into the block's source, marker prefix excluded: "a " = [0,2); the widget
// "$x^2$" = [2,7); " b" = [7,9).
const BLOCK_RAW = 'a $x^2$ b';
const SRC_START = 2;
const SRC_END = 7;
const SOURCE = BLOCK_RAW.slice(SRC_START, SRC_END); // "$x^2$"

// Its inner `textContent` is deliberately one character against a 5-byte source range, so a
// traversal reading `textContent` instead of `data-source-*` would disagree (the same shape as
// widget-offset.test.ts).
function renderedWidget(): HTMLElement {
	const w = document.createElement('span');
	w.setAttribute('data-inline-widget', '');
	w.setAttribute('contenteditable', 'false');
	w.setAttribute('data-source-start', String(SRC_START));
	w.setAttribute('data-source-end', String(SRC_END));
	const inner = document.createElement('span');
	inner.textContent = 'X';
	w.appendChild(inner);
	return w;
}

// `ambientPrefix` stands in for a container's marker span (a list item's "- ", a blockquote's
// "> "): real leading text the DOM traversal counts but the block's source excludes. No prefix
// means a plain paragraph.
function mountBlock(ambientPrefix = ''): HTMLElement {
	const el = document.createElement('div');
	el.setAttribute('contenteditable', 'true');
	if (ambientPrefix) {
		const marker = document.createElement('span');
		marker.className = 'md-marker';
		marker.setAttribute('contenteditable', 'false');
		marker.textContent = ambientPrefix;
		el.appendChild(marker);
	}
	el.append(document.createTextNode('a '), renderedWidget(), document.createTextNode(' b'));
	document.body.appendChild(el);
	el.focus();
	return el;
}

// The swap is done the way the inline code does it: `showSource` replaces the widget with a
// text node, `showRendered` rebuilds it, and the captured node is how a test tells the states
// apart.
function depsFor(el: HTMLElement, ambientPrefix = '') {
	let sourceNode: Text | null = null;
	return {
		get container() {
			return el;
		},
		get sourceStart() {
			return SRC_START;
		},
		get sourceEnd() {
			return SRC_END;
		},
		get source() {
			return SOURCE;
		},
		getAmbientLength: () => ambientPrefix.length,
		isRevealed: () => sourceNode !== null,
		showSource: () => {
			const widget = el.querySelector<HTMLElement>(
				`[data-inline-widget][data-source-start="${SRC_START}"]`
			);
			if (!widget) return;
			sourceNode = document.createTextNode(SOURCE);
			widget.replaceWith(sourceNode);
		},
		showRendered: () => {
			if (sourceNode === null) return;
			sourceNode.replaceWith(renderedWidget());
			sourceNode = null;
		}
	};
}

/** Raw offset of the live collapsed caret, counted as the traversal counts it, marker prefix
 *  included. */
function caretRaw(el: HTMLElement): number {
	const range = window.getSelection()!.getRangeAt(0);
	return domTextOffsetAtNode(el, range.startContainer, range.startOffset);
}

describe('source-reveal — caret-landing model (ambient = 0)', () => {
	let el: HTMLElement;

	beforeEach(() => {
		el = mountBlock();
		window.getSelection()?.removeAllRanges();
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('an opaque widget cannot address an interior source offset — it snaps to an edge', () => {
		// Why showing the source matters: with the widget rendered, an offset inside its source
		// (start+2) resolves to the trailing edge, since a widget the caret cannot enter answers
		// only `SRC_START` or `SRC_END`.
		const pos = findDomTextOffsetTarget(el, asDomTextOffset(SRC_START + 2));
		expect(pos).not.toBeNull();
		expect(domTextOffsetAtNode(el, pos!.node, pos!.offset)).toBe(SRC_END);
	});

	it('reveal(offset) swaps to editable source and lands the caret at the requested interior offset', async () => {
		const reveal = createSourceReveal(depsFor(el));
		await reveal.reveal(2);

		expect(reveal.isRevealed()).toBe(true);
		// The widget is gone; its source bytes are now real text the caret can address.
		expect(el.querySelector('[data-inline-widget]')).toBeNull();
		expect(el.textContent).toContain('$x^2$');
		// The offset inside the source that the rendered widget could not reach (see above).
		expect(caretRaw(el)).toBe(SRC_START + 2);
	});

	it('reveal() defaults to the widget leading edge (node.start)', async () => {
		const reveal = createSourceReveal(depsFor(el));
		await reveal.reveal();
		expect(caretRaw(el)).toBe(SRC_START);
	});

	it('reveal(source.length) lands the caret at the widget trailing edge (node.end)', async () => {
		const reveal = createSourceReveal(depsFor(el));
		await reveal.reveal(SRC_END - SRC_START);
		expect(caretRaw(el)).toBe(SRC_END);
	});

	it('reveal clamps an out-of-range offset to the nearest edge', async () => {
		const reveal = createSourceReveal(depsFor(el));
		await reveal.reveal(999);
		expect(caretRaw(el)).toBe(SRC_END);
		await reveal.reveal(-5);
		expect(caretRaw(el)).toBe(SRC_START);
	});

	it('reveal while already revealed re-places the caret without a second swap', async () => {
		const reveal = createSourceReveal(depsFor(el));
		await reveal.reveal(1);
		expect(caretRaw(el)).toBe(SRC_START + 1);
		await reveal.reveal(3);
		expect(reveal.isRevealed()).toBe(true);
		expect(caretRaw(el)).toBe(SRC_START + 3);
		// Still exactly one source region, not two nested swaps.
		expect(el.querySelector('[data-inline-widget]')).toBeNull();
		expect(el.textContent).toBe('a $x^2$ b');
	});

	it('commit() re-renders the opaque widget and lands the caret at the trailing edge (node.end)', async () => {
		const reveal = createSourceReveal(depsFor(el));
		await reveal.reveal(2);
		await reveal.commit();

		expect(reveal.isRevealed()).toBe(false);
		const widget = el.querySelector('[data-inline-widget]');
		expect(widget).not.toBeNull();
		expect(widget!.getAttribute('data-source-start')).toBe(String(SRC_START));
		expect(widget!.getAttribute('data-source-end')).toBe(String(SRC_END));
		expect(caretRaw(el)).toBe(SRC_END);
	});

	it('commit() is a no-op when not revealed', async () => {
		const reveal = createSourceReveal(depsFor(el));
		await reveal.commit();
		expect(reveal.isRevealed()).toBe(false);
		expect(el.querySelector('[data-inline-widget]')).not.toBeNull();
	});
});

describe('source-reveal — ambient-included offsets (list-item / blockquote math)', () => {
	// A two-character marker prefix the DOM traversal counts but the block's source excludes:
	// every caret lands at `ambientLength + blockSourceOffset`, and passing the bare block offset
	// lands short by the prefix's length.
	const AMBIENT = '- ';
	let el: HTMLElement;

	beforeEach(() => {
		el = mountBlock(AMBIENT);
		window.getSelection()?.removeAllRanges();
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('reveal(offset) lands the caret at ambientLength + sourceStart + offset', async () => {
		const reveal = createSourceReveal(depsFor(el, AMBIENT));
		await reveal.reveal(2);
		expect(caretRaw(el)).toBe(AMBIENT.length + SRC_START + 2);
	});

	it('reveal() defaults to the leading edge in ambient-included space', async () => {
		const reveal = createSourceReveal(depsFor(el, AMBIENT));
		await reveal.reveal();
		expect(caretRaw(el)).toBe(AMBIENT.length + SRC_START);
	});

	it('commit() lands the caret at ambientLength + sourceEnd', async () => {
		const reveal = createSourceReveal(depsFor(el, AMBIENT));
		await reveal.reveal(2);
		await reveal.commit();
		expect(caretRaw(el)).toBe(AMBIENT.length + SRC_END);
	});
});

describe('source-reveal — highest-risk edges', () => {
	let el: HTMLElement;

	beforeEach(() => {
		el = mountBlock();
		window.getSelection()?.removeAllRanges();
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('a selection anchored outside crosses INTO revealed source', async () => {
		const reveal = createSourceReveal(depsFor(el));

		// While rendered, a selection reaching from the surrounding text toward a glyph inside the
		// source can only reach the widget's trailing edge, since it has no inside to land in.
		const rendered = createRangeAtDomTextOffsets(
			el,
			asDomTextOffset(0),
			asDomTextOffset(SRC_START + 2)
		)!;
		expect(domTextOffsetAtNode(el, rendered.startContainer, rendered.startOffset)).toBe(0);
		expect(domTextOffsetAtNode(el, rendered.endContainer, rendered.endOffset)).toBe(SRC_END);

		// With the source shown, the same selection reaches that glyph with its start still in the
		// surrounding text: one shared offset traversal, not a second coordinate space.
		await reveal.reveal();
		const across = createRangeAtDomTextOffsets(
			el,
			asDomTextOffset(0),
			asDomTextOffset(SRC_START + 2)
		)!;
		const sel = window.getSelection()!;
		sel.removeAllRanges();
		sel.addRange(across);
		expect(domTextOffsetAtNode(el, across.startContainer, across.startOffset)).toBe(0);
		expect(domTextOffsetAtNode(el, across.endContainer, across.endOffset)).toBe(SRC_START + 2);
		expect(rawTextOfNode(el, BLOCK_RAW).slice(0, SRC_START + 2)).toBe('a $x');
	});

	it('reveal→commit with no edit is a CST-free view toggle — nothing for undo to span', async () => {
		// This suite's limit: the call changes only temporary DOM, so a cycle with no edit is
		// byte-identical and adds no undo entry; Ctrl+Z across showing the source and committing is
		// the LaTeX e2e's subject.
		const reveal = createSourceReveal(depsFor(el));
		const before = el.querySelector('[data-inline-widget]')!;
		const stamp = (w: Element) =>
			`${w.getAttribute('data-source-start')}:${w.getAttribute('data-source-end')}`;
		const stampBefore = stamp(before);

		await reveal.reveal(2);
		await reveal.commit();

		expect(reveal.isRevealed()).toBe(false);
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe(BLOCK_RAW);
		expect(stamp(el.querySelector('[data-inline-widget]')!)).toBe(stampBefore);
	});

	it('reveal→commit with no edit preserves the block raw byte-for-byte (round-trip)', async () => {
		const reveal = createSourceReveal(depsFor(el));
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe(BLOCK_RAW);
		await reveal.reveal(2);
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe(BLOCK_RAW);
		await reveal.commit();
		expect(rawTextOfNode(el, BLOCK_RAW)).toBe(BLOCK_RAW);
	});
});
