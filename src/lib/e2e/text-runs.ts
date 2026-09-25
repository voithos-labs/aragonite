/**
 * Aim points for pointer gestures, read from where the editor itself puts things on screen: a raw
 * offset through the block's own raw-to-DOM mapping, a word through the text the mode paints. A
 * spec that walks the DOM itself counts widget glyphs and hidden markers its own way and aims
 * somewhere the editor never meant.
 */

import type { Locator, Page } from '@playwright/test';

export interface Point {
	x: number;
	y: number;
}

export interface TextRunRect {
	left: number;
	top: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
	/** The block holding the run, or null for text outside every block. */
	path: number[] | null;
}

/**
 * A point just inside the character on `edge`'s side of raw `offset` in the block at `path` (a
 * container means its first editable leaf), so a click there puts the caret at `offset`.
 */
export async function pointAtRaw(
	page: Page,
	path: number[],
	offset: number,
	edge: 'before' | 'after' = 'after'
): Promise<Point> {
	const point = await page.evaluate(
		({ path, offset, edge }) => (window as any).__test.pointAtRaw(path, offset, edge),
		{ path, offset, edge }
	);
	if (!point)
		throw new Error(`pointAtRaw: no block content at ${JSON.stringify(path)} @ ${offset}`);
	return point;
}

/** The box of the first painted run of `needle`, inside the block at `path` or anywhere in the
 *  editor. A run must sit in one text node; hidden marker text and empty boxes never match. */
export async function textRunRect(
	page: Page,
	needle: string,
	opts: { path?: number[] } = {}
): Promise<TextRunRect> {
	const rect = await page.evaluate(
		({ needle, path }) => (window as any).__test.textRunRect(needle, path),
		{ needle, path: opts.path }
	);
	if (!rect) {
		const where = opts.path ? ` in block ${JSON.stringify(opts.path)}` : '';
		throw new Error(`no painted text run ${JSON.stringify(needle)}${where}`);
	}
	return rect;
}

export async function textRunCenter(
	page: Page,
	needle: string,
	opts: { path?: number[] } = {}
): Promise<Point> {
	const r = await textRunRect(page, needle, opts);
	return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/** A pixel just inside the run's first glyph: a click there lands at the run's start, which no
 *  font metric can move. */
export async function textRunStart(
	page: Page,
	needle: string,
	opts: { path?: number[] } = {}
): Promise<Point> {
	const r = await textRunRect(page, needle, opts);
	return { x: r.left + 1, y: r.top + r.height / 2 };
}

/** A pixel just inside the run's last glyph: a click there lands at the run's end. */
export async function textRunEnd(
	page: Page,
	needle: string,
	opts: { path?: number[] } = {}
): Promise<Point> {
	const r = await textRunRect(page, needle, opts);
	return { x: r.right - 1, y: r.top + r.height / 2 };
}

/**
 * What a click on a widget aims at: the `aim` element inside it when there is one, else the
 * widget. Aim inside when the widget's own box holds something no click lands in (KaTeX's
 * clipped MathML half pulls the box center off the painted glyphs).
 */
export async function widgetAimTarget(widget: Locator, aim?: string): Promise<Locator> {
	const inner = aim ? widget.locator(aim) : null;
	return inner && (await inner.count()) > 0 ? inner.first() : widget;
}

export async function widgetCenter(widget: Locator, aim?: string): Promise<Point> {
	const box = await (await widgetAimTarget(widget, aim)).boundingBox();
	if (!box || box.width === 0) throw new Error('widgetCenter: the widget has no painted box');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * The text an element shows outside its marker spans (container prefixes, inline delimiters,
 * link reference labels, fence lines), whether or not the mode currently paints them.
 */
export async function textOutsideMarkers(element: Locator): Promise<string> {
	return element.evaluate((el) => {
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		let out = '';
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (!node.parentElement?.closest('.md-marker, .md-ref-label, .md-fence-line')) {
				out += node.textContent ?? '';
			}
		}
		return out;
	});
}
