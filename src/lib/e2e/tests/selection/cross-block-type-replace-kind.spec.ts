import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

/**
 * Typing over a cross-block range works out the surviving leaf's kind again
 * (`requirements/selection/cross-block-type-replace-kind.md`). A block marker typed over a
 * range collapsing to offset 0 must reparse the survivor inside the same commit, the way the
 * single-block path does, or the raw carries the marker while the kind stays stale.
 */

async function nestedKind(page: EditorPage['page'], path: number[]): Promise<string | undefined> {
	return page.evaluate((p) => {
		let node = (window as any).__test.getDocument();
		for (const i of p) node = node?.children?.[i];
		return node?.kind as string | undefined;
	}, path);
}

test.describe('cross-block type-replace: kind re-derivation', () => {
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
		// DOM re-rendered as a heading: `BlockHost` writes the live kind onto the wrapper.
		await expect(
			editor.page.locator("[data-block-path='[0]'][data-block-kind='heading']")
		).toHaveCount(1);
		// Source correctness: the marker is the survivor's whole raw.
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe('#');
	});

	// The chord branch of the same replace: the command declines `heading.cycle` while a range
	// is painted, and this path must still land, because the range is gone before it dispatches.
	test('a heading chord over the same selection deletes the range and marks the survivor', async () => {
		await editor.loadContent('aaa\n\nbbb\n');

		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('ControlOrMeta+Shift+End');
		await editor.waitForCrossBlock(true);

		await editor.page.keyboard.press('ControlOrMeta+2');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('##');

		expect(await editor.bridge.getBlockKind(0)).toBe('heading');
		expect((await editor.bridge.getSource()).replace(/\s+$/, '')).toBe('##');
	});

	test('nested: typing ">" inside a blockquote survivor re-parses to a nested blockquote', async () => {
		await editor.loadContent('> hello\n\nworld\n');

		await editor.focusBlockAtPath([0, 0], 0);
		await editor.shiftClickBlock([1], 2);
		await editor.waitForCrossBlock(true);

		await editor.typeSlowly('>');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('> >');

		// The commit inside the container works out the survivor's kind again and rebuilds the
		// ancestor raw: the blockquote child becomes a nested blockquote.
		expect(await nestedKind(editor.page, [0, 0])).toBe('blockquote');
		await expect(
			editor.page.locator("[data-block-path='[0,0]'][data-block-kind='blockquote']")
		).toHaveCount(1);
	});
});
