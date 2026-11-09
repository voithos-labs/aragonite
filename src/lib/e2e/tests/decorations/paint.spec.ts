import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

/**
 * Paint from a plugin value (requirements/decorations/paint.md). A plugin's paint is kept per block
 * while the block's bytes hold, so these rows first pin what an edit changes in the tree.
 */

// Every node by path, with its object and its bytes, kept on the page for `changedSince`.
async function keepNodes(page: Page): Promise<void> {
	await page.evaluate(() => {
		const kept: [string, unknown, string][] = [];
		const walk = (node: any, path: number[]) =>
			(node.children ?? []).forEach((child: any, i: number) => {
				kept.push([[...path, i].join(','), child, child.raw]);
				walk(child, [...path, i]);
			});
		walk((window as any).__test.getDocument(), []);
		(window as any).__keptNodes = kept;
	});
}

// The paths whose node is a new object or holds other bytes than at `keepNodes`.
async function changedSince(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		const now = new Map<string, any>();
		const walk = (node: any, path: number[]) =>
			(node.children ?? []).forEach((child: any, i: number) => {
				now.set([...path, i].join(','), child);
				walk(child, [...path, i]);
			});
		walk((window as any).__test.getDocument(), []);
		const kept: [string, unknown, string][] = (window as any).__keptNodes;
		return kept
			.filter(([key, node, raw]) => now.get(key) !== node || now.get(key)?.raw !== raw)
			.map(([key]) => key);
	});
}

test.describe('what an edit changes in the tree', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const CASES = [
		{ name: 'a paragraph', md: 'one\n\ntwo\n\nthree\n', path: [1], changed: ['1'] },
		{
			name: "a list item's paragraph",
			md: '- one\n- two\n- three\n',
			path: [0, 1, 0],
			changed: ['0', '0,1', '0,1,0']
		},
		{
			name: "a quote's second paragraph",
			md: '> one\n>\n> two\n>\n> three\n',
			path: [0, 1],
			changed: ['0', '0,1']
		}
	];

	for (const { name, md, path, changed } of CASES) {
		test(`typing in ${name} changes only it and its containers`, async ({ page }) => {
			await editor.loadContent(md);
			await editor.focusBlockAtPath(path, 1);
			await keepNodes(page);
			await editor.typeSlowly('x');
			await editor.bridge.waitForSourceContains('txwo');
			expect((await changedSince(page)).sort()).toEqual([...changed].sort());
		});

		test(`a byte splice in ${name} changes only it and its containers`, async ({ page }) => {
			await editor.loadContent(md);
			await keepNodes(page);
			const at = md.indexOf('two') + 1;
			const spliced = await page.evaluate(
				({ source, at }) => (window as any).__test.spliceSource(source, at),
				{ source: md.slice(0, at) + 'x' + md.slice(at), at: at + 1 }
			);
			expect(spliced).toBe(true);
			await editor.bridge.waitForSourceContains('txwo');
			expect((await changedSince(page)).sort()).toEqual([...changed].sort());
		});
	}
});

// Thirty blocks, each `Block <i> text`, every one marked over `Block`.
const MARKED_BLOCKS = Array.from({ length: 30 }, (_, i) => `Block ${i} text`).join('\n\n') + '\n';

async function measuredAfterTyping(page: Page, editor: EditorPage): Promise<string[]> {
	await editor.focusBlockAtPath([3], 7);
	await editor.waitForRenderFlush();
	await page.evaluate(() => {
		(window as any).__test.perf.enable();
		(window as any).__test.perf.reset();
	});
	await editor.typeSlowly('x');
	await editor.bridge.waitForSourceContains('Block 3x text');
	await editor.waitForRenderFlush();
	return page.evaluate(() => (window as any).__test.perf.snapshot().markMeasurePaths);
}

test.describe('what a keystroke measures again', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(MARKED_BLOCKS);
	});

	test('a whole-document source marking every block measures no block but the edited one', async ({
		page
	}) => {
		await page.evaluate(() =>
			(window as any).__test.decorations.addSource({
				name: 'every-block',
				provide: (doc: { children: unknown[] }) =>
					doc.children.map((_, i) => ({ type: 'mark', path: [i], start: 0, end: 5, class: 'm' }))
			})
		);
		await expect.poll(() => page.locator('.decoration-overlay.m').count()).toBe(30);
		const measured = await measuredAfterTyping(page, editor);
		expect(measured.filter((path) => path !== '3')).toEqual([]);
	});
});
