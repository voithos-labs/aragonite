import { expect, type Locator, type Page } from '@playwright/test';
import { BRIDGE_INSTALL_TIMEOUT, EditorPage } from '../../editor-page';

// Shared probe surface for every spec driving the `/test/plugins` harness. Reads go through
// `window.__test` by path — the chained block locator is too slow at scale.

export class PluginsPage extends EditorPage {
	async gotoPlugins(seed?: string): Promise<void> {
		await this.page.goto(seed ? `/test/plugins?seed=${seed}` : '/test/plugins');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: BRIDGE_INSTALL_TIMEOUT
		});
		// Armed for every spec, not per-spec: capture is passive, and a `capturedErrors() === []`
		// assertion against a capture nobody started passes vacuously.
		await this.page.evaluate(() => (window as any).__test.startErrorCapture());
	}

	/** Settles on the ATTRIBUTE, not the call: an unapplied mode falls back to source, where
	 *  most assertions pass anyway and the run reports green without ever entering the rung. */
	async setPresentationMode(mode: string): Promise<void> {
		await this.page.evaluate((m) => (window as any).__test.setPresentationMode(m), mode);
		if (mode === 'source') {
			await expect(this.editorContainer).not.toHaveAttribute('data-presentation');
			return;
		}
		await expect(this.editorContainer).toHaveAttribute('data-presentation', mode);
	}
}

export interface Point {
	x: number;
	y: number;
}

/** One HELD drag between two measured points. Interpolated rather than jumped: the editor's
 *  drag seams read pointermove, and a single hop past them lands as a click. */
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

// CST path of the block holding the DOM caret — the oracle for "the caret landed".
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

// In-view = the block's box intersects the editor viewport, measured independently of
// `scrollTo`'s own report so the assertion isn't tautological.
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

// Click a widget where a user aims: the VISIBLE math. locator.click()'s default point is the first
// content quad's center, and with katex.css loaded the clipped 1px `.katex-mathml` half degenerates
// that point to a corner outside the island, silently missing the reveal hit-test. Target
// `.katex-html` (the painted glyphs) when present; fall back to the island's border-box center.
export async function clickWidgetCenter(widget: Locator): Promise<void> {
	const visible = widget.locator('.katex-html');
	const target = (await visible.count()) > 0 ? visible.first() : widget;
	const box = await target.boundingBox();
	if (!box) throw new Error('widget has no bounding box');
	await target.click({ position: { x: box.width / 2, y: box.height / 2 } });
}

// Reveal a render-primary widget by clicking it and settling on the fold-out: the rendered widget
// vanishes (count 0) and its source becomes editable text. Block math reveals a distinct
// `.math-block-source` element, so it settles its own way.
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
	// The container node's OWN raw, which its rebuildRaw must regenerate from children after every
	// edit. childTexts and roundTripStable both stay green on a stale container raw; only this
	// asserts the rebuild ran.
	raw: string;
}

// Serialized into the page by both the read and the wait, so it must stay CLOSURE-FREE:
// `toString()` carries the body across, not the scope it was written in.
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
	timeout = 2000
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

// Closure-free for the same reason as `containerStateInPage`.
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
	timeout = 2000
): Promise<DocState> {
	await page.waitForFunction(
		({ src, predSrc }) => new Function(`return (${predSrc})((${src})());`)() as boolean,
		{ src: docStateInPage.toString(), predSrc: predicate.toString() },
		{ timeout, polling: 16 }
	);
	return readDoc(page);
}
