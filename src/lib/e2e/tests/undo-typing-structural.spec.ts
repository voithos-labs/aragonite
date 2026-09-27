import { test, expect } from '../fixtures';
import { EditorPage } from '../editor-page';

test.describe('needsUndoCheckpoint, typing / structural / typing', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent('Hello\n');
	});

	test('type-split-type produces three independent undo batches', async () => {
		await editor.focusBlockEnd(0);
		await editor.typeSlowly(' one');
		await editor.bridge.waitForSourceContains(' one');
		await editor.waitForUndoBatchFlush();

		await editor.page.keyboard.press('Enter');

		await editor.typeSlowly('two');
		await editor.bridge.waitForSourceContains('two');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		expect((await editor.bridge.getSource()).includes('two')).toBe(false);
		expect((await editor.bridge.getSource()).includes('Hello one')).toBe(true);

		await editor.undo();
		expect(await editor.getDomBlockCount()).toBe(1);
		expect((await editor.bridge.getSource()).trim()).toBe('Hello one');

		await editor.undo();
		expect((await editor.bridge.getSource()).trim()).toBe('Hello');

		const afterThreeUndos = await editor.bridge.getSource();
		await editor.undo();
		expect(await editor.bridge.getSource()).toBe(afterThreeUndos);
	});
});

// A burst of typing whose last key changes the block's kind is one undo step at every depth: the
// kind-changing key joins the entry the burst opened.

async function eraseUnderlineThenUndo(
	editor: EditorPage,
	seed: string,
	erased: string,
	leafPath: number[]
): Promise<void> {
	await editor.loadContent(seed);
	// The underline's end, in the leaf's own bytes: `Plan\n===`.
	await editor.focusBlockAtPath(leafPath, 8);
	for (let i = 0; i < 3; i++) await editor.page.keyboard.press('Backspace');
	await expect.poll(() => editor.bridge.getSource()).toBe(erased);

	await editor.undo();

	await expect.poll(() => editor.bridge.getSource()).toBe(seed);
	expect((await editor.bridge.getSelectionPaths())?.focus).toEqual({ path: leafPath, offset: 8 });
}

test.describe('undo, a typing burst that ends in a kind change', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	for (const { where, seed, erased, leafPath } of [
		{ where: 'at the top level', seed: 'Plan\n===\n', erased: 'Plan\n\n', leafPath: [0] },
		{ where: 'in a quote', seed: '> Plan\n> ===\n', erased: '> Plan\n>\n', leafPath: [0, 0] }
	]) {
		test(`erasing a setext underline ${where} undoes in one step`, async () => {
			await eraseUnderlineThenUndo(editor, seed, erased, leafPath);
		});
	}

	test('a quote marker typed into a list item undoes in one step, caret before the text', async () => {
		await editor.loadContent('- a\n\n  abcdef');
		await editor.focusBlockAtPath([0, 0, 1], 0);
		await editor.page.keyboard.type('>');
		await expect.poll(() => editor.bridge.getSource()).toContain('>abcdef');

		await editor.undo();

		await expect.poll(() => editor.bridge.getSource()).toBe('- a\n\n  abcdef');
		expect((await editor.bridge.getSelectionPaths())?.focus).toEqual({
			path: [0, 0, 1],
			offset: 0
		});
	});
});

test.describe('undo, a typing burst that ends in a kind change inside a list item', () => {
	// Erasing the underline leaves its emptied line inside the item's paragraph, which the dev
	// stale-raw check reports: a separate defect, declared so this spec tests the undo step.
	test.use({ expectInvariants: ['stale-raw'] });

	test('erasing a setext underline in a list item undoes in one step', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		await eraseUnderlineThenUndo(editor, '- Plan\n  ---\n', '- Plan\n\n', [0, 0, 0]);
	});
});
