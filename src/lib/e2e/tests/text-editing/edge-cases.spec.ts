import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { wholeBlockInput } from '../../whole-block-input';

test.describe('text editing — edge cases', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	// Where the merge does not apply, the caret is the whole outcome: source and block count
	// cannot move, so asserting only those reads the press as doing nothing (issue #138).
	for (const [label, doc, landing, after] of [
		['heading above heading', '# Heading A\n\n## Heading B\n', 11, '# Heading A\n\n## Heading B\n'],
		// The empty heading the caret leaves demotes on blur: a rule of its own, not a merge.
		['prose above a prose-absorber', 'lorem\n\n# \n', 5, 'lorem\n\n\n']
	] as const) {
		test(`Backspace at a heading's start under ${label} — no merge, caret lands at its end`, async () => {
			await editor.loadContent(doc);
			const countBefore = await editor.bridge.getBlockCount();

			await editor.focusBlockStart(1);
			await editor.page.keyboard.press('Backspace');

			await expect
				.poll(async () => await editor.bridge.getSelectionPaths())
				.toMatchObject({ focus: { path: [0], offset: landing } });
			expect(await editor.bridge.getBlockCount()).toBe(countBefore);
			await editor.bridge.waitForSourceEquals(after);
		});
	}

	// The thematic break takes whole-block focus, so a Backspace beside it focuses it and only
	// a second press deletes: the same two-step a mermaid diagram gets
	// (`plugins/mermaid-focus.spec.ts` pins the plugin counterpart).
	test('Backspace after thematic break focuses it, and a second press deletes it', async () => {
		await editor.loadContent('Before\n\n---\n\nAfter\n');
		const original = await editor.bridge.getSource();
		const countBefore = await editor.bridge.getBlockCount();
		const breakBlock = editor.page.locator('.thematic-break-block');

		await editor.focusBlockStart(2);
		await editor.pressDeclined('Backspace');

		await expect(wholeBlockInput(breakBlock)).toBeFocused();
		expect(await editor.bridge.getSource()).toBe(original);
		expect(await editor.bridge.getBlockCount()).toBe(countBefore);

		await editor.page.keyboard.press('Backspace');

		await editor.bridge.waitForSourceNotContains('---');
		expect(await editor.bridge.getBlockCount()).toBeLessThan(countBefore);
	});

	test('Enter at end of heading — heading unchanged, new empty paragraph', async () => {
		await editor.loadContent('# Heading\n');
		await editor.focusBlockEnd(0);
		await editor.page.keyboard.press('Enter');

		await editor.waitForBlockHostCount(2);
		expect(await editor.bridge.getBlockKind(0)).toBe('heading');

		// The empty block is in the bytes rather than absorbed into the heading's trailing
		// blank lines, so reloading them shows the same two blocks.
		const src = await editor.bridge.getSource();
		expect(src).toBe('# Heading\n\n\n');
		await editor.loadContent(src);
		expect(await editor.getDomBlockCount()).toBe(2);
	});
});
