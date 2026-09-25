import { expect, type Locator, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { widgetAimTarget } from '../../text-runs';

// Shared reads for every spec driving the `/test/plugins` harness. They go through `window.__test`
// by path, because the chained block locator is too slow at this scale.

export class PluginsPage extends EditorPage {
	async gotoPlugins(seed?: string): Promise<void> {
		await this.openHarness(seed ? `/test/plugins?seed=${seed}` : '/test/plugins');
		// Started for every spec, not per spec: capturing is passive, and a `capturedErrors() ===
		// []` assertion against a capture nobody started would pass for the wrong reason.
		await this.page.evaluate(() => (window as any).__test.startErrorCapture());
	}
}

export interface Point {
	x: number;
	y: number;
}

/** One held drag between two measured points, moved in steps rather than jumped: the editor's drag
 *  handling reads pointermove, and a single hop past it lands as a click. */
export async function dragBetweenPoints(page: Page, from: Point, to: Point): Promise<void> {
	const steps = 10;
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	for (let i = 1; i <= steps; i++) {
		const t = i / steps;
		await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
	}
	await page.mouse.up();
}

export async function roundTripStable(page: Page): Promise<boolean> {
	return page.evaluate(() => (window as any).__test.roundTripStable());
}

// The CST path of the block holding the DOM caret: how a test sees where the caret landed.
export async function activeBlockPath(page: Page): Promise<number[] | null> {
	return page.evaluate(() => {
		const el = document.activeElement?.closest('[data-block-path]');
		const attr = el?.getAttribute('data-block-path');
		return attr ? (JSON.parse(attr) as number[]) : null;
	});
}

// A `[[toc]]` entry by its visible label. The list lives in the top-level toc block.
export function tocEntry(page: Page, label: string): Locator {
	return page.locator("[data-block-path='[0]'] .toc-block-item").filter({ hasText: label });
}

// In view means the block's box intersects the editor viewport, measured here rather than taken
// from `scrollTo`'s own report, so the assertion is not circular.
export function blockView(
	page: Page,
	path: number[]
): Promise<{ mounted: boolean; inView: boolean }> {
	return page.evaluate((p) => {
		const er = (document.querySelector('.editor') as HTMLElement).getBoundingClientRect();
		const block = document.querySelector(
			`[data-block-path='${JSON.stringify(p)}']`
		) as HTMLElement | null;
		if (!block) return { mounted: false, inView: false };
		const br = block.getBoundingClientRect();
		return { mounted: true, inView: br.top < er.bottom && br.bottom > er.top };
	}, path);
}

export async function capturedErrors(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as any).__test.getCapturedErrors());
}

// Click a widget where a user aims, at the visible math: locator.click()'s default point is the
// center of the first content box, which katex.css's clipped MathML half pulls off the widget.
export async function clickWidgetCenter(widget: Locator): Promise<void> {
	await clickWidgetAt(widget, (width) => width / 2);
}

// A click on a widget puts the caret where it landed, so a spec that wants the caret at the
// construct's end aims there rather than relying on where a click at the center happens to land.
export async function clickWidgetEnd(widget: Locator): Promise<void> {
	await clickWidgetAt(widget, (width) => width - 1);
}

async function clickWidgetAt(widget: Locator, xOf: (width: number) => number): Promise<void> {
	const target = await widgetAimTarget(widget, '.katex-html');
	const box = await target.boundingBox();
	if (!box) throw new Error('widget has no bounding box');
	await target.click({ position: { x: xOf(box.width), y: box.height / 2 } });
}

// Show a render-first widget's source by clicking it and waiting for the swap: the rendered widget
// disappears (count 0) and its source becomes editable text. Block math shows a separate
// `.math-block-source` element, so it is waited for its own way.
export async function revealWidget(widget: Locator): Promise<void> {
	await clickWidgetCenter(widget);
	await expect(widget).toHaveCount(0);
}

// ── Container read: one container node at a root index + its children ──────

export interface ContainerState {
	rootCount: number;
	kind: string;
	childCount: number;
	childKinds: string[];
	// Leaf raws with trailing newlines stripped, so they read as the visible text.
	childTexts: string[];
	// The container node's own raw, which its rebuildRaw must regenerate from the children after
	// every edit. childTexts and roundTripStable both still pass with a stale container raw; only
	// this shows the rebuild ran.
	raw: string;
}

// Serialized into the page by both the read and the wait, so it must reference nothing outside
// itself: `toString()` carries the body across, not the scope it was written in.
function containerStateInPage(index: number): ContainerState {
	const doc = (window as any).__test.getDocument();
	const node = doc.children[index];
	return {
		rootCount: doc.children.length,
		kind: node?.kind ?? '',
		childCount: node?.children?.length ?? 0,
		childKinds: (node?.children ?? []).map((c: { kind?: string }) => c.kind ?? ''),
		childTexts: (node?.children ?? []).map((c: { raw?: string }) =>
			(c.raw ?? '').replace(/\n+$/, '')
		),
		raw: node?.raw ?? ''
	};
}

export async function readContainer(page: Page, index = 0): Promise<ContainerState> {
	return page.evaluate(
		({ i, src }) => new Function('i', `return (${src})(i);`)(i) as ContainerState,
		{ i: index, src: containerStateInPage.toString() }
	);
}

export async function waitForContainer(
	page: Page,
	index: number,
	predicate: (s: ContainerState) => boolean,
	timeout = 5000
): Promise<ContainerState> {
	await page.waitForFunction(
		({ i, src, predSrc }) => new Function('i', `return (${predSrc})((${src})(i));`)(i) as boolean,
		{ i: index, src: containerStateInPage.toString(), predSrc: predicate.toString() },
		{ timeout, polling: 16 }
	);
	return readContainer(page, index);
}

// ── Document read: the root children's kinds + visible texts ───────────────

export interface DocState {
	rootCount: number;
	kinds: string[];
	// Root-child raws with trailing newlines stripped, so they read as visible text.
	texts: string[];
}

// References nothing outside itself, for the same reason as `containerStateInPage`.
function docStateInPage(): DocState {
	const children = (window as any).__test.getDocument().children as {
		kind: string;
		raw?: string;
	}[];
	return {
		rootCount: children.length,
		kinds: children.map((c) => c.kind),
		texts: children.map((c) => (c.raw ?? '').replace(/\n+$/, ''))
	};
}

export async function readDoc(page: Page): Promise<DocState> {
	return page.evaluate(
		(src) => new Function(`return (${src})();`)() as DocState,
		docStateInPage.toString()
	);
}

export async function waitForDoc(
	page: Page,
	predicate: (s: DocState) => boolean,
	timeout = 5000
): Promise<DocState> {
	await page.waitForFunction(
		({ src, predSrc }) => new Function(`return (${predSrc})((${src})());`)() as boolean,
		{ src: docStateInPage.toString(), predSrc: predicate.toString() },
		{ timeout, polling: 16 }
	);
	return readDoc(page);
}
