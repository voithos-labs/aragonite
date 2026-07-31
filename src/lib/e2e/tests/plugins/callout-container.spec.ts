import { test, expect } from '../../fixtures';
import { PluginsPage, readContainer, waitForContainer, roundTripStable } from './helpers';

// Read the callout by CST path through the bridge: document root child [0] is the callout, and its
// children are the paragraphs the edits must move — never the document root.

test.describe('plugin container: :::note callout editability', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	test('type, split, merge, and undo mutate the callout children, never the root', async ({
		page
	}) => {
		// Seed parsed as a real container, not a fallback paragraph. Child 0 is the reserved
		// editable title; the body paragraph follows it.
		let state = await readContainer(page);
		expect(state.kind).toBe('note');
		expect(state.rootCount).toBe(1);
		expect(state.childCount).toBe(2);
		expect(state.childTexts).toEqual(['Title', 'First']);

		// Type into the callout's body paragraph (child 1, NOT the title row).
		await page.locator('.callout-block [contenteditable="true"]', { hasText: /^First$/ }).click();
		await page.keyboard.press('End');
		await editor.typeText(' one');
		state = await waitForContainer(page, 0, (s) => s.childTexts[1] === 'First one');
		expect(state.rootCount).toBe(1);
		expect(state.childCount).toBe(2);
		await editor.waitForUndoBatchFlush();

		// Split: Enter mid-body must add a THIRD child to the callout — a broken
		// container would instead grow the document root (rootCount === 2).
		await page.keyboard.press('Enter');
		state = await waitForContainer(page, 0, (s) => s.childCount === 3);
		expect(state.rootCount).toBe(1);
		expect(state.childTexts[1]).toBe('First one');
		expect(await roundTripStable(page)).toBe(true);

		await editor.typeText('two');
		const afterSplitTyping = await waitForContainer(page, 0, (s) => s.childTexts[2] === 'two');
		expect(afterSplitTyping.rootCount).toBe(1);
		expect(afterSplitTyping.childCount).toBe(3);
		expect(afterSplitTyping.childTexts).toEqual(['Title', 'First one', 'two']);
		// The callout's own raw was rebuilt from ALL children — a stale raw would still read the
		// seed opener line alone. The blank line between the body paragraphs is the split's
		// separator, re-emitted by that same rebuild.
		expect(afterSplitTyping.raw).toBe(':::note Title\nFirst one\n\ntwo\n:::\n');
		expect(await editor.bridge.getSource()).toBe(':::note Title\nFirst one\n\ntwo\n:::\n');
		expect(await roundTripStable(page)).toBe(true);
		await editor.waitForUndoBatchFlush();

		// Merge: caret to the start of the last child (real Home), then Backspace
		// folds it back into the previous body paragraph — never into the title.
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');
		const afterMerge = await waitForContainer(page, 0, (s) => s.childCount === 2);
		expect(afterMerge.rootCount).toBe(1);
		expect(afterMerge.childTexts).toEqual(['Title', 'First onetwo']);
		expect(afterMerge.raw).toBe(':::note Title\nFirst onetwo\n:::\n');
		expect(await editor.bridge.getSource()).toBe(':::note Title\nFirst onetwo\n:::\n');
		expect(await roundTripStable(page)).toBe(true);
		await editor.waitForUndoBatchFlush();

		// Undo the merge → back to the captured three-child split state, uncorrupted.
		await editor.undo();
		const undoneMerge = await waitForContainer(page, 0, (s) => s.childCount === 3);
		expect(undoneMerge.rootCount).toBe(1);
		expect(undoneMerge.childTexts).toEqual(afterSplitTyping.childTexts);
		// Undo restored the container's own raw, not just the leaf children.
		expect(undoneMerge.raw).toBe(afterSplitTyping.raw);
		expect(await roundTripStable(page)).toBe(true);

		// Undo the "two" typing → the last body child loses its text, root untouched.
		await editor.undo();
		const undoneTyping = await waitForContainer(page, 0, (s) => s.childTexts[2] === '');
		expect(undoneTyping.rootCount).toBe(1);
		expect(undoneTyping.childCount).toBe(3);
		expect(await roundTripStable(page)).toBe(true);
	});

	test('a cross-block copy ending mid-title pastes back as a real note, not bare text', async ({
		page
	}) => {
		await editor.loadContent('Above\n\n:::note Title\nBody\n:::\n\nBelow\n');

		// Drag-select from the prose above into the middle of the title, then copy.
		await editor.dragFromTo([0], 2, [1, 0], 3);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);
		await page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();

		// Paste into "Below": wrapper-less bytes would reparse to a paragraph; the
		// synthesized closer makes them reparse to a second `:::note`.
		await editor.clickBlock(2);
		await editor.waitForCrossBlock(false);
		await page.keyboard.press('End');
		await page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceMatches(/:::note[\s\S]*:::note/);

		const noteCount = await page.evaluate(
			() =>
				(window as any).__test
					.getDocument()
					.children.filter((c: { kind: string }) => c.kind === 'note').length
		);
		expect(noteCount).toBe(2);
	});
});
