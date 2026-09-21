import { test, expect } from '../../../fixtures';
import { EditorPage } from '../../../editor-page';

// Without a closer, the serialized document is an open fence that GFM lazy continuation pulls the
// blocks below back into on reload, so the live tree stops matching a reparse of its own bytes.
// The only way out while writing is Enter on the empty trailing line (`computeFenceExit`).

test.describe('code block: unclosed-fence auto-close on escape', () => {
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

		expect(await editor.bridge.getSource()).toBe('```\ncode\n```\n\nafter\n');
		expect(await editor.bridge.getBlockCount()).toBe(2);
		expect(await editor.parseConverged()).toBe(true);
	});

	// The other place a fence can be left open: the keystroke that creates it. Without a closer,
	// the live tree settles to the reload's reading, which swallows everything below (GH #180).
	test('a fence opener typed above other blocks closes as it is created', async ({ page }) => {
		await editor.loadContent('Above\n\ntail\n');
		await editor.getBlock(0).click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');
		await editor.typeSlowly('```');
		await editor.bridge.waitForSourceContains('```\n```');

		expect(await editor.bridge.getBlockKind(1)).toBe('fencedCode');
		expect(await editor.getBlockText(2)).toBe('tail');
		expect(await editor.parseConverged()).toBe(true);

		// The caret stayed on the opener's own line, so Enter opens the body under it.
		await page.keyboard.press('Enter');
		await editor.typeText('code');
		await editor.bridge.waitForSourceContains('```\ncode\n```');
		expect(await editor.bridge.getSource()).toBe('Above\n\n```\ncode\n```\n\ntail\n');
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

		expect(await editor.bridge.getBlockKind(0)).toBe('fencedCode');
		expect(await editor.bridge.getSource()).not.toContain('```\ncode\n```');
	});

	// The one place this runs is the container's own `blockEdit`: a fence nested in a quote closes
	// itself inside that quote, leaving the new paragraph there too.
	test('nested: escape below an unclosed fence in a blockquote closes it and converges', async () => {
		await editor.loadContent('> ```\n> code\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');

		await editor.focusBlockAtPath([0, 0], 8); // end of the code display "```\ncode"
		await editor.page.keyboard.press('Enter'); // trailing blank line inside the body
		await editor.page.keyboard.press('Enter'); // escape to a new block below
		await editor.typeText('below');
		await editor.bridge.waitForSourceContains('below');

		expect(await editor.parseConverged()).toBe(true);
		expect(await editor.bridge.getBlockKind(0)).toBe('blockquote');
		const source = await editor.bridge.getSource();
		expect(source).toContain('> ```\n> code\n> ```'); // closer written, still quoted
	});
});
