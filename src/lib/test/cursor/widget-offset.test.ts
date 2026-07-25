// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { asDomTextOffset } from '../../cursor/coordinate-spaces';
import {
	containerDomTextLength,
	findDomTextOffsetTarget,
	domTextOffsetAtNode,
	rawTextOfNode
} from '../../cursor/widget-offset';

describe('findDomTextOffsetTarget — widget boundary placement', () => {
	let el: HTMLElement;

	beforeEach(() => {
		el = document.createElement('div');
		document.body.appendChild(el);
	});

	function widget(start: number, end: number): HTMLElement {
		const w = document.createElement('span');
		w.setAttribute('data-inline-widget', '');
		w.setAttribute('data-image-widget', '');
		w.setAttribute('contenteditable', 'false');
		w.setAttribute('data-source-start', String(start));
		w.setAttribute('data-source-end', String(end));
		// Non-empty inner so a faulty walker that reads textContent would diverge.
		const img = document.createElement('img');
		w.appendChild(img);
		return w;
	}

	function sentinel(): Text {
		return document.createTextNode('');
	}

	it('lands inside the trailing text-node sentinel for widget end offset', () => {
		// Layout: [widget(0..10), sentinel] — image-only paragraph.
		const w = widget(0, 10);
		const trailing = sentinel();
		el.append(w, trailing);

		const pos = findDomTextOffsetTarget(el, asDomTextOffset(10));
		expect(pos).not.toBeNull();
		// Caret should land inside the trailing sentinel, not at parent + idx+1.
		// Otherwise Chromium drops beforeinput at this position.
		expect(pos!.node).toBe(trailing);
		expect(pos!.offset).toBe(0);
	});

	it('lands inside the leading text-node sentinel for widget start offset', () => {
		// Layout: [sentinel, widget(0..10)].
		const leading = sentinel();
		const w = widget(0, 10);
		el.append(leading, w);

		const pos = findDomTextOffsetTarget(el, asDomTextOffset(0));
		expect(pos).not.toBeNull();
		expect(pos!.node).toBe(leading);
		expect(pos!.offset).toBe(0);
	});

	it('lands inside the inter-widget sentinel between two adjacent widgets', () => {
		// Layout: [widget(0..10), sentinel, widget(10..20)] — target = 10 (between).
		const w1 = widget(0, 10);
		const between = sentinel();
		const w2 = widget(10, 20);
		el.append(w1, between, w2);

		const pos = findDomTextOffsetTarget(el, asDomTextOffset(10));
		expect(pos).not.toBeNull();
		// Should land inside the inter-sentinel (text-node), not at parent boundary.
		expect(pos!.node).toBe(between);
		expect(pos!.offset).toBe(0);
	});

	it('falls back to parent-level position when no text node neighbors the widget', () => {
		// Layout without sentinels: [widget(0..10)] — backward-compat.
		const w = widget(0, 10);
		el.appendChild(w);

		const pos = findDomTextOffsetTarget(el, asDomTextOffset(10));
		expect(pos).not.toBeNull();
		expect(pos!.node).toBe(el);
		expect(pos!.offset).toBe(1);
	});

	it('lands in a real text node when one sits next to the widget (no sentinel needed)', () => {
		// Layout: [widget(0..10), text " trail"].
		const w = widget(0, 10);
		const trailText = document.createTextNode(' trail');
		el.append(w, trailText);

		const pos = findDomTextOffsetTarget(el, asDomTextOffset(10));
		expect(pos).not.toBeNull();
		expect(pos!.node).toBe(trailText);
		expect(pos!.offset).toBe(0);
	});

	it('falls back to end-of-content when target exceeds the block length', () => {
		// CURSOR_END (= MAX_SAFE_INTEGER) relies on this fallback to land the
		// caret at the end of any block; a finite sentinel below the length
		// would instead resolve mid-block.
		const text = document.createTextNode('hello');
		el.appendChild(text);

		const pos = findDomTextOffsetTarget(el, asDomTextOffset(Number.MAX_SAFE_INTEGER));
		expect(pos).not.toBeNull();
		expect(pos!.node).toBe(text);
		expect(pos!.offset).toBe('hello'.length);
	});

	it('domTextOffsetAtNode reads zero from sentinel positions (preserves text-content invariants)', () => {
		const leading = sentinel();
		const w = widget(0, 10);
		const trailing = sentinel();
		el.append(leading, w, trailing);

		// Caret in trailing sentinel at offset 0 corresponds to raw 10 (after widget).
		expect(domTextOffsetAtNode(el, trailing, 0)).toBe(10);
		// Caret in leading sentinel at offset 0 corresponds to raw 0.
		expect(domTextOffsetAtNode(el, leading, 0)).toBe(0);
	});
});

describe('domTextOffsetAtNode — positions at or inside an atomic widget', () => {
	// Layout: text "ab" [0,2) · island [2,15) · text "cd" [15,17). The island's
	// inner text is 4 chars against a 13-byte source range, so a walk that
	// descended into it would land 9 bytes short of the contract.
	let el: HTMLElement;
	let island: HTMLElement;

	beforeEach(() => {
		el = document.createElement('div');
		el.innerHTML =
			'<span>ab</span>' +
			'<span data-inline-widget data-source-start="2" data-source-end="15" contenteditable="false">' +
			'<span>A+B</span><span>a</span></span>' +
			'<span>cd</span>';
		document.body.appendChild(el);
		island = el.querySelector<HTMLElement>('[data-inline-widget]')!;
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('walks the island as its raw source length', () => {
		expect(containerDomTextLength(el)).toBe(17);
	});

	it('reads a parent-container position past the island as the island end', () => {
		expect(domTextOffsetAtNode(el, el, 2)).toBe(15);
	});

	it('snaps a position on the island element itself to its own walk boundary', () => {
		expect(domTextOffsetAtNode(el, island, 0)).toBe(2);
		expect(domTextOffsetAtNode(el, island, island.childNodes.length)).toBe(15);
	});

	it('snaps a position inside the island — the browser rebinds carets into these', () => {
		// contenteditable=false islands attract carets; the walk has no interior
		// positions to report, so an interior node resolves to an edge, never to
		// the container's total length.
		const inner = island.querySelector('span')!.firstChild!;
		expect(domTextOffsetAtNode(el, inner, 0)).toBe(2);
		expect(domTextOffsetAtNode(el, inner, 1)).toBe(15);
	});

	it('reads a position outside the container as end-of-walk', () => {
		// Document order against a disconnected tree is implementation-specific, so
		// an unreachable position must not resolve to a guessed interior offset.
		// Callers that need "not mine" as an answer test containment themselves.
		const foreign = document.createElement('span');
		foreign.append(document.createTextNode('zz'));

		expect(domTextOffsetAtNode(el, foreign, 0)).toBe(17);
		expect(domTextOffsetAtNode(el, foreign.firstChild!, 1)).toBe(17);
	});

	it('snaps past an island with no inner text (image island)', () => {
		// `![alt](url)` renders as an <img>: zero textContent against a 12-byte
		// source range, so a textContent-driven walk drops the span entirely.
		const block = document.createElement('div');
		block.innerHTML =
			'<span>a</span>' +
			'<span data-inline-widget data-source-start="1" data-source-end="13" contenteditable="false">' +
			'<img></span>';
		const image = block.querySelector<HTMLElement>('[data-inline-widget]')!;

		expect(domTextOffsetAtNode(block, image, image.childNodes.length)).toBe(13);
	});
});

describe('malformed widget source range', () => {
	it('widget missing data-source-end contributes zero length and empty raw text', () => {
		const el = document.createElement('div');
		const w = document.createElement('span');
		w.setAttribute('data-inline-widget', '');
		w.setAttribute('data-source-start', '0');
		const text = document.createTextNode('ab');
		el.append(w, text);

		expect(rawTextOfNode(w, '0123456789')).toBe('');
		expect(rawTextOfNode(el, '0123456789')).toBe('ab');
		expect(containerDomTextLength(el)).toBe(2);
	});
});
