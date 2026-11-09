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
