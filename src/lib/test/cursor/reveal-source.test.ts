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

// Fixture: a paragraph "a $x^2$ b" whose $…$ math renders as one atomic widget.
//   block source:  a _ $ x ^ 2 $ _ b   (index 0..8, length 9)
//   text before "a " = [0,2); widget "$x^2$" = [2,7); text after " b" = [7,9)
// These are BLOCK-source offsets — they exclude any rendered marker prefix.
const BLOCK_RAW = 'a $x^2$ b';
const SRC_START = 2;
const SRC_END = 7;
const SOURCE = BLOCK_RAW.slice(SRC_START, SRC_END); // "$x^2$"

// Rendered widget stub. Inner textContent is one char — deliberately a different
// length from the 5-byte source range, so a walker that read textContent instead
// of data-source-* would diverge (mirrors widget-offset.test.ts's rationale).
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

// `ambientPrefix` models a container block's marker span (list item "- ",
// blockquote "> "): real leading text the DOM walk counts but block source
// excludes. An empty prefix is a plain paragraph (ambient = 0).
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

// The swap is injected: `showSource` replaces the opaque widget with a text node,
// `showRendered` rebuilds the widget; the captured node is the revealed-state flag
// the primitive reads. This mirrors the inline consumer's own closure.
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

/** Raw offset of the live collapsed caret, in ambient-included walk space. */
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
		// The justification for reveal: with the widget rendered, a request for an
		// interior source position (start+2) resolves to the trailing EDGE, never
		// the interior glyph. An atomic widget yields only raw SRC_START or SRC_END.
		const pos = findDomTextOffsetTarget(el, asDomTextOffset(SRC_START + 2));
		expect(pos).not.toBeNull();
		expect(domTextOffsetAtNode(el, pos!.node, pos!.offset)).toBe(SRC_END);
	});

	it('reveal(offset) swaps to editable source and lands the caret at the requested interior offset', async () => {
		const reveal = createSourceReveal(depsFor(el));
		await reveal.reveal(2);

		expect(reveal.isRevealed()).toBe(true);
		// Opaque widget gone; its source bytes are now real, addressable text.
		expect(el.querySelector('[data-inline-widget]')).toBeNull();
		expect(el.textContent).toContain('$x^2$');
		// The interior offset the rendered widget could not reach (contrast above).
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
	// A 2-char marker prefix the DOM walk counts but block source excludes. Every
	// caret must land at `ambientLength + blockSourceOffset`; a primitive that fed
	// the bare block offset to the DOM walk would mis-land by exactly `ambient`.
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

		// Rendered: a selection reaching from the outside text ("a ") toward an
		// interior source glyph can only reach the widget's trailing EDGE — the
		// opaque island has no interior to land in.
		const rendered = createRangeAtDomTextOffsets(
			el,
			asDomTextOffset(0),
			asDomTextOffset(SRC_START + 2)
		)!;
		expect(domTextOffsetAtNode(el, rendered.startContainer, rendered.startOffset)).toBe(0);
		expect(domTextOffsetAtNode(el, rendered.endContainer, rendered.endOffset)).toBe(SRC_END);

		// Revealed: the same cross-boundary selection now reaches the interior
		// glyph, its start still anchored in the outside text — the boundary is
		// crossed through the one shared offset walk, not a second coordinate space.
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
		// Unit scope: the primitive mutates only transient DOM, never the CST or the
		// undo stack, so a no-edit cycle is byte-identical and produces no undo
		// entry. Genuine Ctrl+Z across a reveal→commit needs the editor's undo stack
		// (LaTeX block/inline e2e); here we pin the invariant that makes it safe.
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
