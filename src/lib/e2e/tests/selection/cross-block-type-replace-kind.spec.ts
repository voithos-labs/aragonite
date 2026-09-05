import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

/**
 * Cross-block type-replace re-derives the surviving leaf's kind
 * (requirements/selection/cross-block-type-replace-kind.md). A block marker typed over a
 * range collapsing to offset 0 must re-parse the survivor INSIDE the commit, at parity with
 * the single-block path — otherwise the raw carries the marker while the kind stays stale.
 */

async function nestedKind(page: EditorPage['page'], path: number[]): Promise<string | undefined> {
	return page.evaluate((p) => {
		let node = (window as any).__test.getDocument();
		for (const i of p) node = node?.children?.[i];
		return node?.kind as string | undefined;
	}, path);
}

test.describe('cross-block type-replace — kind re-derivation', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('top-level: typing "#" over a full cross-block selection re-parses to a heading', async () => {
		await editor.loadContent('aaa\n\nbbb\n');

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.typeSlowly('#');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('#');

		// CST kind re-derived.
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
		// DOM re-rendered as a heading: BlockHost stamps the live kind on the wrapper.
		await expect(
			editor.page.locator("[data-block-path='[0]'][data-block-kind='heading']")
		).toHaveCount(1);
		// Source correctness: the marker is the survivor's whole raw.
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe('#');
	});

	test('nested: typing ">" inside a blockquote survivor re-parses to a nested blockquote', async () => {
		await editor.loadContent('> hello\n\nworld\n');

		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.typeSlowly('>');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('> >');

		// The container-scope commit path re-derives the survivor's kind and rebuilds
		// the ancestor raw — the blockquote child becomes a nested blockquote.
		expect(await nestedKind(editor.page, [0, 0])).toBe('blockquote');
		await expect(
			editor.page.locator("[data-block-path='[0,0]'][data-block-kind='blockquote']")
		).toHaveCount(1);
	});
});
