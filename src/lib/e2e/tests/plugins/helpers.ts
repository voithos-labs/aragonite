import { expect, type Locator, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Shared probe surface for the plugin e2e specs (callout, directive, latex,
// details, reserved-chrome, admonitions). Every gate reads the CST/selection by
// path through `window.__test` — the chained block locator is too slow at scale.
// `gotoPlugins(seed?)` loads the `/test/plugins` harness on the named seed; the
// read helpers snapshot either one container node or the document root.

export class PluginsPage extends EditorPage {
	async gotoPlugins(seed?: string): Promise<void> {
		await this.page.goto(seed ? `/test/plugins?seed=${seed}` : '/test/plugins');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
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

export async function capturedErrors(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as any).__test.getCapturedErrors());
}

// Reveal a render-primary widget by clicking it and settling on the fold-out: the
// rendered widget vanishes (count 0) and its source becomes editable text. Block
// math reveals a distinct `.math-block-source` element, so it settles its own way.
export async function revealWidget(widget: Locator): Promise<void> {
	await widget.click();
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
	// The container node's OWN raw — the value its rebuildRaw must regenerate from
	// children after every edit. childTexts and roundTripStable both stay green on a
	// stale container raw; only this asserts the rebuild ran.
	raw: string;
}

export async function readContainer(page: Page, index = 0): Promise<ContainerState> {
	return page.evaluate((i) => {
		const node = (window as any).__test.getDocument().children[i];
		return {
			rootCount: (window as any).__test.getDocument().children.length,
			kind: node?.kind ?? '',
			childCount: node?.children?.length ?? 0,
			childKinds: (node?.children ?? []).map((c: { kind?: string }) => c.kind ?? ''),
			childTexts: (node?.children ?? []).map((c: { raw?: string }) =>
				(c.raw ?? '').replace(/\n+$/, '')
			),
			raw: node?.raw ?? ''
		};
	}, index);
}

export async function waitForContainer(
	page: Page,
	index: number,
	predicate: (s: ContainerState) => boolean,
	timeout = 2000
): Promise<ContainerState> {
	await page.waitForFunction(
		({ i, predSrc }) => {
			const node = (window as any).__test.getDocument().children[i];
			const state = {
				rootCount: (window as any).__test.getDocument().children.length,
				kind: node?.kind ?? '',
				childCount: node?.children?.length ?? 0,
				childKinds: (node?.children ?? []).map((c: { kind?: string }) => c.kind ?? ''),
				childTexts: (node?.children ?? []).map((c: { raw?: string }) =>
					(c.raw ?? '').replace(/\n+$/, '')
				),
				raw: node?.raw ?? ''
			};
			return new Function('s', `return (${predSrc})(s);`)(state);
		},
		{ i: index, predSrc: predicate.toString() },
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

export async function readDoc(page: Page): Promise<DocState> {
	return page.evaluate(() => {
		const children = (window as any).__test.getDocument().children as {
			kind: string;
			raw?: string;
		}[];
		return {
			rootCount: children.length,
			kinds: children.map((c) => c.kind),
			texts: children.map((c) => (c.raw ?? '').replace(/\n+$/, ''))
		};
	});
}

export async function waitForDoc(
	page: Page,
	predicate: (s: DocState) => boolean,
	timeout = 2000
): Promise<DocState> {
	await page.waitForFunction(
		(predSrc) => {
			const children = (window as any).__test.getDocument().children as {
				kind: string;
				raw?: string;
			}[];
			const state = {
				rootCount: children.length,
				kinds: children.map((c) => c.kind),
				texts: children.map((c) => (c.raw ?? '').replace(/\n+$/, ''))
			};
			return new Function('s', `return (${predSrc})(s);`)(state);
		},
		predicate.toString(),
		{ timeout, polling: 16 }
	);
	return readDoc(page);
}
