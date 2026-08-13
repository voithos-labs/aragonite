// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { applyIslandDecorations, type ApplyIslandsOpts } from '$lib/decorations/island-dom';
import { takeDevWarns } from '../support/warn-gate';
import { mountDecorationWidget } from '$lib/decorations/widget-dom';
import type { IndexedDecoration } from '$lib/decorations/buckets';
import type { ReplaceDecoration, WidgetDecoration } from '$lib/decorations/types';
import { rawTextOfNode } from '$lib/cursor/widget-offset';
import { buildAmbientSpan } from '$lib/ambient/ambient-dom';
import { contentLengthOf, parseInline } from '$lib/core/inline';
import { renderInlineNodes } from '$lib/core/inline-render';

function build(raw: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	frag.appendChild(renderInlineNodes(parseInline(raw, 0, raw.length), raw));
	return frag;
}

// The heading path: a block-own `.md-marker` span over raw.slice(0, markerLen)
// (editable raw bytes — unlike the contenteditable=false ambient span).
function buildWithMarkerPrefix(raw: string, markerLen: number): DocumentFragment {
	const frag = document.createDocumentFragment();
	const marker = document.createElement('span');
	marker.className = 'md-marker';
	marker.textContent = raw.slice(0, markerLen);
	frag.appendChild(marker);
	frag.appendChild(renderInlineNodes(parseInline(raw, markerLen, raw.length), raw));
	return frag;
}

/** The shared walk's read-back: text nodes verbatim plus data-source spans. */
const walkRawText = (root: Node, raw: string): string => rawTextOfNode(root, raw);

function walkRawTextSkippingAmbient(frag: DocumentFragment, raw: string): string {
	let out = '';
	for (const child of Array.from(frag.childNodes)) {
		if (child !== frag.firstChild) out += rawTextOfNode(child, raw);
	}
	return out;
}

const widgetAt = (offset: number): WidgetDecoration => ({
	type: 'widget',
	path: [0],
	offset,
	widget: { buildDom: () => document.createElement('span') }
});
const replaceRange = (start: number, end: number): ReplaceDecoration => ({
	type: 'replace',
	path: [0],
	start,
	end
});
const idx = <D extends WidgetDecoration | ReplaceDecoration>(
	dec: D,
	index = 0
): IndexedDecoration<D> => ({ dec, index });

/** Every fixture here renders its whole raw, so a paragraph over it is the CST the gate reads. */
const optsFor = (raw: string): ApplyIslandsOpts => ({
	mountWidget: (spec, dec) => mountDecorationWidget(spec, dec),
	contentLength: contentLengthOf({ kind: 'paragraph', leadingTrivia: '', raw })
});

describe('applyIslandDecorations', () => {
	it('widget island contributes zero raw bytes at its offset', () => {
		const raw = 'hello world';
		const frag = build(raw);
		applyIslandDecorations(frag, raw, [idx(widgetAt(5))], optsFor(raw));
		const island = frag.querySelector('[data-decoration-island]')!;
		expect(island.getAttribute('data-source-start')).toBe('5');
		expect(island.getAttribute('data-source-end')).toBe('5');
		expect(island.getAttribute('contenteditable')).toBe('false');
		expect(island.hasAttribute('data-inline-widget')).toBe(true);
		expect(walkRawText(frag, raw)).toBe(raw);
	});

	it('replace island carries the covered bytes and removes covered DOM', () => {
		const raw = 'hide **me** now';
		const frag = build(raw);
		applyIslandDecorations(frag, raw, [idx(replaceRange(5, 11))], optsFor(raw));
		expect(walkRawText(frag, raw)).toBe(raw);
		expect(frag.textContent).not.toContain('me');
	});

	it('replace range ending inside a styled wrapper splits the wrapper, bytes intact', () => {
		const raw = 'ab **cd** ef';
		const frag = build(raw);
		applyIslandDecorations(frag, raw, [idx(replaceRange(0, 7))], optsFor(raw)); // ends inside **cd**
		expect(walkRawText(frag, raw)).toBe(raw);
		expect(frag.querySelector('[data-decoration-island]')!.getAttribute('data-source-end')).toBe(
			'7'
		);
	});

	it('two islands apply without offset drift (descending application)', () => {
		const raw = 'one two three';
		const frag = build(raw);
		applyIslandDecorations(frag, raw, [idx(widgetAt(3)), idx(replaceRange(8, 13))], optsFor(raw));
		expect(frag.querySelectorAll('[data-decoration-island]').length).toBe(2);
		expect(walkRawText(frag, raw)).toBe(raw);
	});

	it('offsets are ambient-adjusted; the ambient span is untouched', () => {
		const raw = 'task text';
		const frag = build(raw);
		frag.prepend(buildAmbientSpan('- ')); // ambient bytes are NOT in raw
		applyIslandDecorations(frag, raw, [idx(widgetAt(0))], { ...optsFor(raw), ambientLength: 2 });
		const island = frag.querySelector('[data-decoration-island]')!;
		expect(island.previousSibling).toBe(frag.firstChild); // lands after the ambient span
		expect(walkRawTextSkippingAmbient(frag, raw)).toBe(raw);
	});

	it('block-own marker prefix counts as raw bytes', () => {
		const raw = '## head';
		const frag = buildWithMarkerPrefix(raw, 3);
		applyIslandDecorations(frag, raw, [idx(replaceRange(3, 7))], optsFor(raw));
		expect(walkRawText(frag, raw)).toBe(raw); // marker bytes still counted, content replaced
		expect(frag.textContent).toBe('## ');
	});

	// Miss-analysis: this pass never saw the document its decorations were derived from, and
	// no test drove it with a mismatched pair — so the one shape it cannot judge, a decoration
	// the document has since outgrown, was the shape it reported as an authoring error.
	it('an island the content no longer holds is dropped silently — staleness is not the author’s', () => {
		const raw = 'short';
		const frag = build(raw);
		const onSkipped = vi.fn();
		applyIslandDecorations(frag, raw, [idx(replaceRange(2, 99))], {
			...optsFor(raw),
			onSkipped
		});
		expect(onSkipped).not.toHaveBeenCalled();
		expect(frag.querySelectorAll('[data-decoration-island]').length).toBe(0);
		expect(frag.textContent).toBe(raw);
	});

	// A replace island holds bytes the DOM text no longer carries, so a bound measured off
	// this pass's own output would shrink under it. The gate reads the CST's answer instead.
	it('re-applies over a range a mounted island already covers', () => {
		const raw = 'hide **me** now';
		const frag = build(raw);
		applyIslandDecorations(frag, raw, [idx(replaceRange(5, 11))], optsFor(raw));
		const onSkipped = vi.fn();
		applyIslandDecorations(frag, raw, [idx(replaceRange(5, 11))], {
			...optsFor(raw),
			onSkipped
		});
		expect(onSkipped).not.toHaveBeenCalled();
		expect(frag.querySelector('[data-decoration-island]')!.getAttribute('data-source-end')).toBe(
			'11'
		);
		expect(walkRawText(frag, raw)).toBe(raw);
	});
});

// A nonzero-span atomic widget (image / `<br>`): a [data-inline-widget] span
// carrying its raw bytes via data-source-* while contributing 0 textContent.
function buildWithAtomicWidget(
	raw: string,
	widgetStart: number,
	widgetEnd: number
): DocumentFragment {
	const frag = document.createDocumentFragment();
	frag.appendChild(document.createTextNode(raw.slice(0, widgetStart)));
	const widget = document.createElement('span');
	widget.dataset.inlineWidget = '';
	widget.dataset.sourceStart = String(widgetStart);
	widget.dataset.sourceEnd = String(widgetEnd);
	widget.setAttribute('contenteditable', 'false');
	frag.appendChild(widget);
	frag.appendChild(document.createTextNode(raw.slice(widgetEnd)));
	return frag;
}

// A text-position range can't split an atomic widget, so a boundary strictly inside
// one snaps outward. Sole guard for that branch — the island property's corpus emits
// no widgets, so its descending pass never reaches it.
describe('replace boundary inside an atomic widget snaps outward', () => {
	const raw = 'abIMAGEcd'; // 'ab' + widget over raw[2,7)='IMAGE' + 'cd'
	const cases = [
		{ name: 'start boundary snaps to the widget start', span: [4, 9], snapped: [2, 9] },
		{ name: 'end boundary snaps to the widget end', span: [0, 4], snapped: [0, 7] }
	] as const;

	for (const { name, span, snapped } of cases) {
		it(name, () => {
			const frag = buildWithAtomicWidget(raw, 2, 7);
			applyIslandDecorations(frag, raw, [idx(replaceRange(span[0], span[1]))], optsFor(raw));
			const island = frag.querySelector('[data-decoration-island]')!;
			expect(island.getAttribute('data-source-start')).toBe(String(snapped[0]));
			expect(island.getAttribute('data-source-end')).toBe(String(snapped[1]));
			expect(walkRawText(frag, raw)).toBe(raw);
			const fires = takeDevWarns();
			expect(fires).toHaveLength(1);
			expect(fires[0].message).toContain(
				`snapped ${span[0]}..${span[1]} outward to ${snapped[0]}..${snapped[1]}`
			);
		});
	}
});
