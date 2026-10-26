/**
 * The tint over a shown widget source, painted with the CSS Custom Highlight API so the source stays
 * plain text the offset walk reads. Without the API (jsdom, an old browser) it shows untinted.
 */

import { rawRangeToDomRange, type RawRange } from '../../../browser/offsets';

const SOURCE_HIGHLIGHT = 'md-inline-reveal';
const washes = new WeakMap<HTMLElement, Range>();

function sourceHighlight(): Highlight | null {
	if (typeof CSS === 'undefined' || !('highlights' in CSS) || typeof Highlight !== 'function') {
		return null;
	}
	let highlight = CSS.highlights.get(SOURCE_HIGHLIGHT);
	if (!highlight) {
		highlight = new Highlight();
		CSS.highlights.set(SOURCE_HIGHLIGHT, highlight);
	}
	return highlight;
}

/** Tints `range` of the block `el` draws, replacing its previous tint; null clears it. */
export function washShownSource(el: HTMLElement, range: RawRange | null): void {
	const previous = washes.get(el);
	// Every render of every block passes here, and almost none shows a source.
	if (!range && !previous) return;
	const highlight = sourceHighlight();
	if (previous) {
		highlight?.delete(previous);
		washes.delete(el);
	}
	if (!highlight || !range) return;
	const dom = rawRangeToDomRange(el, range.start, range.end);
	if (!dom) return;
	washes.set(el, dom);
	highlight.add(dom);
}
