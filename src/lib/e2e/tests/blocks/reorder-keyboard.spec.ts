import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';

// Reorder finds the block from the caret path and moves it among its siblings. Focus lands at
// offset 0 of the moved block, so a character typed after the move goes in front of the text,
// not after it.
test.describe('keyboard reorder', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('Alt+ArrowDown moves a top-level block down, focus follows', async () => {
		await editor.loadContent('A\n\nB\n\nC\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).click();
		await editor.page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/A[\s\S]*C[\s\S]*B/);
		await editor.page.keyboard.type('X');
		await editor.bridge.waitForSourceMatches(/A[\s\S]*C[\s\S]*XB/);
	});

	test('Alt+ArrowUp moves the third list item up (index >= 2)', async () => {
		await editor.loadContent('- one\n- two\n- three\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'three' }).click();
		await editor.page.keyboard.press('Alt+ArrowUp');
		await editor.bridge.waitForSourceMatches(/- one[\s\S]*- three[\s\S]*- two/);
	});

	test('Alt+ArrowDown moves the first list item down', async () => {
		await editor.loadContent('- one\n- two\n- three\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'one' }).click();
		await editor.page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/- two[\s\S]*- one[\s\S]*- three/);
	});

	// "9. " and "10. " differ in length, so the caret has to be placed past the item's new marker.
	for (const { chord, from, expected } of [
		{ chord: 'Alt+ArrowDown', from: 8, expected: '10. Xitem9\n' },
		{ chord: 'Alt+ArrowUp', from: 9, expected: '9. Xitem10\n' }
	]) {
		test(`${chord} across 9 and 10 lands past the renumbered marker`, async () => {
			const doc = Array.from({ length: 10 }, (_, i) => `${i + 1}. item${i + 1}`).join('\n');
			await editor.loadContent(doc + '\n');
			await editor.focusBlockAtPath([0, from, 0], 3);
			await editor.page.keyboard.press(chord);
			await editor.waitForRenderFlush();
			await editor.page.keyboard.type('X');
			await editor.bridge.waitForSourceContains(expected);
		});
	}

	test('Alt+ArrowUp moves a blockquote child up; single undo restores', async () => {
		await editor.loadContent('> a\n>\n> b\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'b' }).click();
		await editor.page.keyboard.press('Alt+ArrowUp');
		await editor.bridge.waitForSourceMatches(/> b[\s\S]*> a/);
		await editor.page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals('> a\n>\n> b\n');
	});

	// Any top-level block can be reordered, not only prose: a leaf kind takes the chord through
	// its own `runCommand` and reorder context, not through `TextEditableBlock`.
	test('Alt+ArrowDown moves a fenced code block below its sibling; single undo restores', async () => {
		await editor.loadContent('```\ncode\n```\n\ntail\n');
		await editor.getBlock(0).click(); // caret inside the code block
		await editor.page.keyboard.press('Alt+ArrowDown');
		await editor.bridge.waitForSourceMatches(/tail[\s\S]*```[\s\S]*code[\s\S]*```/);
		await editor.page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals('```\ncode\n```\n\ntail\n');
	});

	test('Alt+ArrowUp moves a thematic break above its sibling', async () => {
		await editor.loadContent('lead\n\n---\n');
		await editor.getBlock(1).click(); // focus the divider, which lands on its editing host
		await editor.page.keyboard.press('Alt+ArrowUp');
		await editor.bridge.waitForSourceMatches(/---[\s\S]*lead/);
	});

	// The same empty position by chord, on the pair whose join rewrites the prose too: a rule flush
	// under a paragraph is a setext underline, which turns the paragraph into a heading and takes
	// the divider with it.
	test('Alt+ArrowUp lands a divider whole under a paragraph', async () => {
		await editor.loadContent('Intro\n# Heading\n\n---\n');
		await editor.getBlock(2).click(); // focus the divider
		await editor.page.keyboard.press('Alt+ArrowUp');

		await editor.bridge.waitForSourceEquals('Intro\n\n---\n\n# Heading\n');
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		expect(await editor.bridge.getBlockKind(1)).toBe('thematicBreak');
		expect(await editor.parseConverged()).toBe(true);
	});

	// An HTML block runs to the next blank line, so the move writes one under it where the moved
	// paragraph took that line away; otherwise the quote and the list would reload as HTML text.
	test('Alt+ArrowUp leaves the blocks under an HTML block their own', async () => {
		const source = 'Intro\n<div>\nx\n</div>\n\nSecond\n> quoted line\n- one\n- two\n';
		await editor.loadContent(source);
		await editor.page.locator('[contenteditable="true"]', { hasText: 'Second' }).click();
		await editor.page.keyboard.press('Alt+ArrowUp');

		await editor.bridge.waitForSourceEquals(
			'Intro\n\nSecond\n\n<div>\nx\n</div>\n\n> quoted line\n- one\n- two\n'
		);
		expect(await editor.bridge.getBlockKind(3)).toBe('blockquote');
		expect(await editor.bridge.getBlockKind(4)).toBe('list');
		expect(await editor.parseConverged()).toBe(true);

		// The blank line is part of the move, so one undo takes both.
		await editor.page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals(source);
	});

	// A blank line kept the paragraph and the table apart above the heading; moving the heading
	// away keeps one between them, or the table would reload as the paragraph's text.
	test('Alt+ArrowUp keeps apart the pair a blank line separated', async () => {
		const source = 'Intro\n\n# Heading\n| A | B |\n| --- | --- |\n| 1 | 2 |\n';
		await editor.loadContent(source);
		await editor.page.locator('[contenteditable="true"]', { hasText: 'Heading' }).click();
		await editor.page.keyboard.press('Alt+ArrowUp');

		await editor.bridge.waitForSourceEquals(
			'# Heading\n\nIntro\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
		);
		expect(await editor.bridge.getBlockKind(2)).toBe('table');
		expect(await editor.parseConverged()).toBe(true);

		await editor.page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals(source);
	});

	// The same rule inside a quote: the quote's HTML block keeps the blank line under it.
	test('Alt+ArrowUp inside a quote leaves the nested quote its own', async () => {
		const source = '> <div>\n> x\n> </div>\n>\n> Second\n> > inner\n';
		await editor.loadContent(source);
		await editor.page.locator('[contenteditable="true"]', { hasText: 'Second' }).last().click();
		await editor.page.keyboard.press('Alt+ArrowUp');

		await editor.bridge.waitForSourceEquals('> Second\n>\n> <div>\n> x\n> </div>\n>\n> > inner\n');
		expect(await editor.parseConverged()).toBe(true);

		await editor.page.keyboard.press('ControlOrMeta+z');
		await editor.bridge.waitForSourceEquals(source);
	});

	// With no final line break, the block that gains a follower ends its line and the block that
	// becomes last gives up its ending, in the document's own line ending.
	for (const [ending, eol] of [
		['LF', '\n'],
		['CRLF', '\r\n']
	] as const) {
		for (const { chord, before, caretIn, after } of [
			{ chord: 'Alt+ArrowUp', before: `a${eol}# b`, caretIn: 'b', after: `# b${eol}a` },
			{ chord: 'Alt+ArrowDown', before: `# a${eol}b`, caretIn: 'a', after: `b${eol}# a` }
		]) {
			test(`${chord} with no final line break keeps both lines apart (${ending})`, async () => {
				await editor.loadContent(before);
				await editor.page.locator('[contenteditable="true"]', { hasText: caretIn }).click();
				await editor.page.keyboard.press(chord);

				await editor.bridge.waitForSourceEquals(after);
				expect(await editor.parseConverged()).toBe(true);

				await editor.page.keyboard.press('ControlOrMeta+z');
				await editor.bridge.waitForSourceEquals(before);
			});
		}
	}

	// A move with no sibling in that direction must change nothing and add no undo entry, or the
	// press at the boundary silently eats a Ctrl+Z. The unit test for the clamp skips the keymap
	// dispatch this goes through.
	test('Alt+Arrow at a boundary is a no-op and creates no undo entry', async () => {
		await editor.loadContent('A\n\nB\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'A' }).click();
		await editor.page.keyboard.press('Home');
		await editor.page.keyboard.type('X');
		await editor.bridge.waitForSourceEquals('XA\n\nB\n');

		await editor.pressDeclined('Alt+ArrowUp'); // first block — nothing above
		expect(await editor.bridge.getSource()).toBe('XA\n\nB\n');

		await editor.page.keyboard.press('ControlOrMeta+z'); // undoes the typing, not a stray reorder
		await editor.bridge.waitForSourceEquals('A\n\nB\n');
	});

	test('Alt+ArrowDown on the last block is a no-op', async () => {
		await editor.loadContent('A\n\nB\n');
		await editor.page.locator('[contenteditable="true"]', { hasText: 'B' }).click();
		const before = await editor.bridge.getSource();
		await editor.pressDeclined('Alt+ArrowDown');
		expect(await editor.bridge.getSource()).toBe(before);
	});
});
