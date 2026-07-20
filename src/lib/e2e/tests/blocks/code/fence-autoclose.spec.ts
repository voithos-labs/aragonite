import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Authoring an escape below an UNCLOSED fence mints the closing fence into the
// code node's raw, as one commit. Without it the serialized document is an open
// fence followed by the trailing blocks' bytes, which GFM lazy-continuation
// absorbs back INTO the code block on reload — the live tree diverges from a
// reparse of its own serialization. The escape gesture is Enter on the empty
// trailing line (computeFenceExit's unclosed branch), the sole authoring escape.

const parseConverged = (editor: EditorPage) =>
	editor.page.evaluate(() => (window as any).__test.parseConverged() as boolean);

test.describe('code block — unclosed-fence auto-close on escape', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Enter-escape below an unclosed fence closes it and converges', async () => {
		await editor.loadContent('```\ncode\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');

		await editor.getBlock(0).click();
		await editor.page.keyboard.press('Control+End');
		await editor.page.keyboard.press('Enter'); // trailing blank line inside the body
		await editor.page.keyboard.press('Enter'); // escape to a new paragraph below
		await editor.typeText('after');
		await editor.bridge.waitForSourceContains('after');

		// The closer is minted; the paragraph is a distinct block after it.
		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n\nafter\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		// The live tree matches a reparse of its serialization — no absorption.
		expect(await parseConverged(editor)).toBe(true);
	});

	test('one undo restores the open fence and removes the created block', async () => {
		await editor.loadContent('```\ncode\n');
		await editor.getBlock(0).click();
		await editor.page.keyboard.press('Control+End');
		await editor.page.keyboard.press('Enter');
		await editor.page.keyboard.press('Enter');
		await editor.bridge.waitForBlockCount(2);
		// Pre-condition the atomicity depends on: the escape closed the fence.
		expect(await editor.bridge.getSource()).toContain('```\ncode\n```');

		await editor.undo();
		await editor.bridge.waitForBlockCount(1);

		// The fence is open again and the appended paragraph is gone — one entry.
		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		expect(await editor.bridge.getSource()).not.toContain('```\ncode\n```');
	});

	// The choke point is the container-scoped blockEdit, so a fence nested in a
	// blockquote auto-closes within its own scope — the new paragraph stays inside
	// the quote and the container's raw rebuilds cleanly (parse-convergence proves
	// the reparse matches the live tree).
	test('nested: escape below an unclosed fence in a blockquote closes it and converges', async () => {
		await editor.loadContent('> ```\n> code\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');

		await editor.focusBlockAtPath([0, 0], 8); // end of the code display "```\ncode"
		await editor.page.keyboard.press('Enter'); // trailing blank line inside the body
		await editor.page.keyboard.press('Enter'); // escape to a new block below
		await editor.typeText('below');
		await editor.bridge.waitForSourceContains('below');

		expect(await parseConverged(editor)).toBe(true);
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		const source = await editor.bridge.getSource();
		expect(source).toContain('> ```\n> code\n> ```'); // closer minted, still quoted
	});
});
