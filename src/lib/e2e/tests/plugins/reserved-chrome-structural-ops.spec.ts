import { test, expect } from '../../fixtures';
import {
	PluginsPage,
	readNote,
	activeBlockPath,
	capturedErrors,
	stateConsistencyViolations,
	FIXTURE
} from './reserved-chrome-helpers';

/**
 * Fork-A spike gate: the `:::note` callout reserves child 0 as an editable
 * `note-title` chrome leaf (see src/routes/test/plugins/callout).
 *
 * Gate 2 — reserved-index-0 structural ops. The merge walk targets the last
 *   BODY child (never the title); an interior Backspace against the not-mergeable
 *   title moves focus instead of merging; typing keeps the note-title kind
 *   (contextDependentKind); Enter in the title descends into the body (chrome is
 *   single-line — it never splits); title-start Backspace is a safe no-op.
 *
 * Gate 5 — paste into the title. A multi-block clipboard dropped in the title
 *   flattens to a single line spliced at the caret; the chrome never splits and
 *   the container-paste family never fires for it.
 */
test.describe('Fork-A spike — reserved child-0 chrome: structural ops + paste', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	// ── Gate 2 — reserved-index-0 structural ops ─────────────────────────────

	test('Gate 2a: Backspace after the callout merges into the last BODY child, not the title', async ({
		page
	}) => {
		// Callout followed by a top-level paragraph to fold in.
		await editor.loadContent('Above\n\n:::note Title\nBody\n:::\n\nAfter\n');
		await editor.focusBlockAtPath([2], 0); // start of "After"
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('BodyAfter');

		const note = await readNote(page, 1);
		expect(note.childCount).toBe(2);
		expect(note.childTexts[0]).toBe('Title'); // title untouched
		expect(note.childTexts[1]).toBe('BodyAfter'); // merged into last body child
		expect(await editor.bridge.getSource()).not.toMatch(/^After$/m);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2b(i): Backspace at start of the first body child does NOT merge into the title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 1], 0); // start of "Body"
		await page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();

		// The not-mergeable title refuses the merge; focus moves to the title end,
		// the tree is unchanged — body prose never enters chrome.
		const note = await readNote(page, 1);
		expect(note.childCount).toBe(2);
		expect(note.childTexts).toEqual(['Title', 'Body']);
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2b(ii): Backspace at start of the title is a no-op', async ({ page }) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 0); // start of "Title"
		await page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();

		// firstChildBackspace='lift-first-child' resolves to unwrapFirstChildFromBlockquote,
		// which is hard-gated to kind==='blockquote' and returns [] for the callout —
		// so the strategy early-returns. The chrome is neither lifted nor destroyed.
		const note = await readNote(page, 1);
		expect(note.rootCount).toBe(2);
		expect(note.childCount).toBe(2);
		expect(note.childTexts).toEqual(['Title', 'Body']);
		expect(await editor.bridge.getSource()).toBe(FIXTURE);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2c: Enter at the end of the title descends into the body, never splitting the chrome', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await page.keyboard.press('Enter');

		// The reserved-chrome contract: chrome is single-line by serialization, so
		// Enter routes to chrome.descendToBody (the registerChromeLeaf default) —
		// a pure focus move into the first body child, no split, no commit.
		await expect.poll(() => activeBlockPath(page)).toEqual([1, 1]);

		const note = await readNote(page, 1);
		expect(note.childCount).toBe(2);
		expect(note.childKinds).toEqual(['note-title', 'paragraph']);
		expect(note.childTexts).toEqual(['Title', 'Body']);
		expect(note.raw).toBe(':::note Title\nBody\n:::\n');
		expect(await editor.bridge.getSource()).toBe(FIXTURE);

		// The caret landed at body offset 0: a typed character heads the body text.
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('XBody');
		expect((await readNote(page, 1)).childTexts).toEqual(['Title', 'XBody']);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2c (empty body): Enter in a title-only callout mints and focuses an empty body paragraph', async ({
		page
	}) => {
		await editor.loadContent('Above\n\n:::note Title\n:::\n');
		const seed = await readNote(page, 1);
		expect(seed.childCount).toBe(1);
		expect(seed.childKinds).toEqual(['note-title']);

		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await page.keyboard.press('Enter');
		await expect.poll(() => activeBlockPath(page)).toEqual([1, 1]);

		const note = await readNote(page, 1);
		expect(note.childCount).toBe(2);
		expect(note.childKinds).toEqual(['note-title', 'paragraph']);
		expect(note.childTexts).toEqual(['Title', '']);

		// The minted paragraph is a live caret target, not just a CST splice.
		await editor.typeText('New body');
		await editor.bridge.waitForSourceContains('New body');
		expect((await readNote(page, 1)).childTexts).toEqual(['Title', 'New body']);
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

		// Descend on an existing body is a pure focus move: were it to push a dead
		// undo entry, this single undo would consume it and "BodyQ" would survive.
		// Poll the CST children (not the source bytes) so the assert waits for the tree
		// to re-materialize the reverted text.
		await editor.undo();
		await expect.poll(() => readNote(page, 1).then((n) => n.childTexts)).toEqual(['Title', 'Body']);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2d: typing into the title KEEPS the note-title kind (contextDependentKind)', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains(':::note TitleX');

		// note-title is registered via registerChromeLeaf, so it carries
		// contextDependentKind. updateNodeContent honors that flag: a content commit
		// writes raw and keeps the kind instead of re-deriving it from the bare title
		// line (which has no recognizer and would downgrade to paragraph).
		const note = await readNote(page, 1);
		expect(note.childKinds[0]).toBe('note-title');
		expect(note.childTexts[0]).toBe('TitleX');
		expect(await editor.bridge.getSource()).toContain(':::note TitleX');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2e: the reserved chrome row keeps BlockListState ids/refs in lockstep across edits', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		// A structural edit inside the callout, then a merge — the windowing-adjacent
		// invariant (ids/refs length === children length) must hold with the reserved
		// chrome row present.
		await editor.focusBlockAtPath([1, 1], 4); // end of "Body"
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(5);
		await editor.typeText('more');
		await editor.bridge.waitForSourceContains('more');

		expect(await stateConsistencyViolations(page)).toEqual([]);
		const note = await readNote(page, 1);
		expect(note.childKinds[0]).toBe('note-title'); // chrome row still index 0
		expect(await capturedErrors(page)).toEqual([]);
	});
	// ── Gate 5 — paste into the title ────────────────────────────────────────

	test('Gate 5: pasting a multi-block clipboard into the title flattens inline, one chrome node', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await page.evaluate(() => navigator.clipboard.writeText('x\n\ny'));
		await page.keyboard.press('Control+v');
		await editor.bridge.waitForSourceContains(':::note Titlex y');

		// Newlines collapse to a single space; the chrome stays one note-title node
		// instead of splitting into paragraphs.
		const note = await readNote(page, 1);
		expect(note.childCount).toBe(2);
		expect(note.childKinds).toEqual(['note-title', 'paragraph']);
		expect(note.childTexts).toEqual(['Titlex y', 'Body']);
		expect(await editor.bridge.getSource()).toBe('Above\n\n:::note Titlex y\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);
	});
});
