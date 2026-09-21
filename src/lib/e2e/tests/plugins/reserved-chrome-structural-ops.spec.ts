import { test, expect } from '../../fixtures';
import {
	PluginsPage,
	readCallout,
	activeBlockPath,
	capturedErrors,
	stateConsistencyViolations,
	FIXTURE
} from './reserved-chrome-helpers';

/**
 * The `:::callout` callout reserves child 0 as an editable `callout-title` row (see
 * src/routes/test/plugins/callout). Part 2, structural edits around that reserved child 0: a merge
 * targets the last body child and never the title; a Backspace inside against the unmergeable
 * title moves focus instead of merging; typing keeps the kind; and Enter moves into the body,
 * since the title never splits. Part 5: a paste of several blocks into the title becomes one line.
 */
test.describe('reserved child-0 chrome: structural ops + paste', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	// ── Part 2: structural edits around the reserved child 0 ─────────────────

	test('Gate 2a: Backspace after the callout merges into the last BODY child, not the title', async ({
		page
	}) => {
		// A callout followed by a top-level paragraph to merge into it.
		await editor.loadContent('Above\n\n:::callout Title\nBody\n:::\n\nAfter\n');
		await editor.focusBlockAtPath([2], 0); // start of "After"
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('BodyAfter');

		const callout = await readCallout(page, 1);
		expect(callout.childCount).toBe(2);
		expect(callout.childTexts[0]).toBe('Title'); // title untouched
		expect(callout.childTexts[1]).toBe('BodyAfter'); // merged into last body child
		expect(await editor.bridge.getSource()).not.toMatch(/^After$/m);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2b(i): Backspace at start of the first body child does NOT merge into the title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 1], 0); // start of "Body"
		await editor.pressDeclined('Backspace');

		// The unmergeable title refuses the merge, so focus moves to the title's end and the tree
		// is unchanged: body prose never enters the title.
		const callout = await readCallout(page, 1);
		expect(callout.childCount).toBe(2);
		expect(callout.childTexts).toEqual(['Title', 'Body']);
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2b(ii): Backspace at start of the title is a no-op', async ({ page }) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 0); // start of "Title"
		await editor.pressDeclined('Backspace');

		// The callout declares firstChildBackspace='keep-reserved-chrome', which says child 0 is
		// its title row, so nothing is lifted out and the title is neither moved nor destroyed.
		const callout = await readCallout(page, 1);
		expect(callout.rootCount).toBe(2);
		expect(callout.childCount).toBe(2);
		expect(callout.childTexts).toEqual(['Title', 'Body']);
		expect(await editor.bridge.getSource()).toBe(FIXTURE);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2c: Enter at the end of the title descends into the body, never splitting the chrome', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await page.keyboard.press('Enter');

		// A title row is one line by the way it serializes, so Enter goes to chrome.descendToBody,
		// the registerChromeLeaf default: focus moves into the first body child, with no split
		// and no commit.
		await expect.poll(() => activeBlockPath(page)).toEqual([1, 1]);

		const callout = await readCallout(page, 1);
		expect(callout.childCount).toBe(2);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['Title', 'Body']);
		expect(callout.raw).toBe(':::callout Title\nBody\n:::\n');
		expect(await editor.bridge.getSource()).toBe(FIXTURE);

		// The caret landed at body offset 0, so a typed character starts the body text.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('XBody');
		expect((await readCallout(page, 1)).childTexts).toEqual(['Title', 'XBody']);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2c (empty body): Enter in a title-only callout mints and focuses an empty body paragraph', async ({
		page
	}) => {
		await editor.loadContent('Above\n\n:::callout Title\n:::\n');
		const seed = await readCallout(page, 1);
		expect(seed.childCount).toBe(1);
		expect(seed.childKinds).toEqual(['callout-title']);

		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await page.keyboard.press('Enter');
		await expect.poll(() => activeBlockPath(page)).toEqual([1, 1]);

		const callout = await readCallout(page, 1);
		expect(callout.childCount).toBe(2);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['Title', '']);

		// The new paragraph is a real place for the caret, not just a splice in the CST.
		await editor.typeText('New body');
		await editor.bridge.waitForSourceContains('New body');
		expect((await readCallout(page, 1)).childTexts).toEqual(['Title', 'New body']);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2c (undo): descend commits nothing — one undo reverts the edit made before it', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 1], 4); // end of "Body"
		await editor.typeText('Q');
		await editor.bridge.waitForSourceContains('BodyQ');
		await editor.waitForUndoBatchFlush();

		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await page.keyboard.press('Enter');
		await expect.poll(() => activeBlockPath(page)).toEqual([1, 1]);

		// Moving into an existing body only moves focus: if it pushed an empty undo entry, this
		// one undo would spend it and "BodyQ" would survive. Poll the children in the CST, not the
		// source bytes, so the assertion waits for the tree to rebuild the reverted text.
		await editor.undo();
		await expect
			.poll(() => readCallout(page, 1).then((n) => n.childTexts))
			.toEqual(['Title', 'Body']);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2d: typing into the title KEEPS the callout-title kind (contextDependentKind)', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains(':::callout TitleX');

		// callout-title is registered through registerChromeLeaf, so it has contextDependentKind,
		// and updateNodeContent honours that: a commit writes the raw and keeps the kind instead
		// of deriving it again from the bare title line, which nothing recognizes and which would
		// come back as a paragraph.
		const callout = await readCallout(page, 1);
		expect(callout.childKinds[0]).toBe('callout-title');
		expect(callout.childTexts[0]).toBe('TitleX');
		expect(await editor.bridge.getSource()).toContain(':::callout TitleX');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2e: the reserved chrome row keeps BlockListState ids/refs in lockstep across edits', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		// A structural edit inside the callout, then a merge: the rule that the ids and references
		// match the children in number must hold with the title row there.
		await editor.focusBlockAtPath([1, 1], 4); // end of "Body"
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(5);
		await editor.typeText('more');
		await editor.bridge.waitForSourceContains('more');

		expect(await stateConsistencyViolations(page)).toEqual([]);
		const callout = await readCallout(page, 1);
		expect(callout.childKinds[0]).toBe('callout-title'); // chrome row still index 0
		expect(await capturedErrors(page)).toEqual([]);
	});
	// ── Part 5: pasting into the title ───────────────────────────────────────

	test('Gate 5: pasting a multi-block clipboard into the title flattens inline, one chrome node', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await editor.seedClipboard('x\n\ny');
		await editor.paste();
		await editor.bridge.waitForSourceContains(':::callout Titlex y');

		// Newlines collapse to one space and the title stays a single callout-title node rather
		// than splitting into paragraphs.
		const callout = await readCallout(page, 1);
		expect(callout.childCount).toBe(2);
		expect(callout.childKinds).toEqual(['callout-title', 'paragraph']);
		expect(callout.childTexts).toEqual(['Titlex y', 'Body']);
		expect(await editor.bridge.getSource()).toBe('Above\n\n:::callout Titlex y\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);
	});
});
