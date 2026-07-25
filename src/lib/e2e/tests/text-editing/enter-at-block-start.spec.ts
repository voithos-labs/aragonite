import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Enter at raw offset 0 of a non-empty text block: empty block above, content
// below, caret staying on the content. Requirements: enter-at-block-start.md.
// Source bytes alone can't discriminate a real split from a trivia bump — the
// block-host count and the caret path are the load-bearing assertions.

test.describe('text editing — Enter at block start', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	const kinds = [
		{ label: 'paragraph', content: 'Content\n', kind: 'paragraph' },
		{ label: 'heading', content: '## Title\n', kind: 'heading' },
		{ label: 'setext heading', content: 'Title\n=====\n', kind: 'setextHeading' }
	];

	for (const { label, content, kind } of kinds) {
		test(`Enter at offset 0 of a ${label} — empty block above, caret on the content`, async () => {
			await editor.loadContent(content);
			await editor.focusBlockStart(0);
			await editor.page.keyboard.press('Enter');
			await editor.waitForBlockHostCount(2);

			expect(await editor.bridge.getBlockKind(1)).toBe(kind);
			await editor.bridge.waitForSourceEquals('\n' + content);
			expect(await editor.page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
			// The live tree converges with a reparse of its bytes — the real mutation
			// oracle; the byte round-trip above is a tautology for valid GFM.
			expect(await editor.page.evaluate(() => (window as any).__test.parseConverged())).toBe(true);

			const selection = await editor.bridge.getSelectionPaths();
			expect(selection?.focus).toEqual({ path: [1], offset: 0 });
		});
	}

	test('real click + Home + Enter on a paragraph — typing lands at the head of the content', async () => {
		await editor.loadContent('Content\n');
		await editor.clickBlock(0);
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2);

		await editor.typeSlowly('X');
		await editor.bridge.waitForSourceEquals('\nXContent\n');
	});

	test('Enter at offset 0 of a blockquote first child — empty block above at the same nesting level', async () => {
		await editor.loadContent('> quoted\n');
		await editor.focusBlockAtPath([0, 0], 0);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(3);

		const audit = await editor.page.evaluate(() =>
			(window as any).__test.auditBlockListStateConsistency()
		);
		expect(audit).toEqual([]);
		expect(await editor.page.evaluate(() => (window as any).__test.roundTripStable())).toBe(true);
		expect(await editor.page.evaluate(() => (window as any).__test.parseConverged())).toBe(true);

		await editor.typeSlowly('X');
		await editor.bridge.waitForSourceContains('Xquoted');
	});

	test('undo after Enter at offset 0 restores the single-block source', async () => {
		await editor.loadContent('Content\n');
		await editor.focusBlockStart(0);
		await editor.page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(2);
		await editor.bridge.waitForSourceEquals('\nContent\n');

		await editor.undo();
		await editor.bridge.waitForSourceEquals('Content\n');
		await editor.waitForBlockHostCount(1);
	});
});
