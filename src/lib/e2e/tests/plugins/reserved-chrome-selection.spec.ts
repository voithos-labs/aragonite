import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

/**
 * Fork-A spike gate: the `:::note` callout reserves child 0 as an editable
 * `note-title` chrome leaf (see src/routes/test/plugins/callout). Two axes:
 *
 * Gate 1 — selection parity. A cross-block selection from the paragraph above
 *   the callout paints continuously INTO the title, and caret/undo land there.
 *   Prediction: passes with zero new selection machinery (the title carries a
 *   char offset, so none of the seven `kind === 'table'` coordinate gates fire).
 *
 * Gate 2 — reserved-index-0 structural ops. The merge walk targets the last
 *   BODY child (never the title); an interior Backspace against the not-mergeable
 *   title moves focus instead of merging; typing keeps the note-title kind
 *   (contextDependentKind); Enter in the title descends into the body (chrome is
 *   single-line — it never splits); title-start Backspace is a safe no-op.
 *
 * Gate 4 — the rangeDelete chrome wall. Nothing merges across the note's wall:
 *   outside endpoints truncate in place, covered chrome clears (never
 *   node-deletes), and the container dies only when the range consumes its
 *   whole subtree from outside. Body-only ranges stay on the generic path.
 *
 * Gate 5 — paste into the title. A multi-block clipboard dropped in the title
 *   flattens to a single line spliced at the caret; the chrome never splits and
 *   the container-paste family never fires for it.
 */
class PluginsPage extends EditorPage {
	async gotoPlugins() {
		await this.page.goto('/test/plugins');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, {
			timeout: 10_000
		});
	}
}

interface NoteState {
	rootCount: number;
	kind: string;
	childCount: number;
	childKinds: string[];
	childTexts: string[];
	raw: string;
}

// Read the callout at root index `noteIndex` through the CST bridge. Trailing
// newlines are trimmed so childTexts read as visible text.
async function readNote(page: Page, noteIndex: number): Promise<NoteState> {
	return page.evaluate((i) => {
		const doc = (window as any).__test.getDocument();
		const note = doc.children[i];
		return {
			rootCount: doc.children.length,
			kind: note?.kind ?? '',
			childCount: note?.children?.length ?? 0,
			childKinds: (note?.children ?? []).map((c: { kind?: string }) => c.kind ?? ''),
			childTexts: (note?.children ?? []).map((c: { raw?: string }) =>
				(c.raw ?? '').replace(/\n+$/, '')
			),
			raw: note?.raw ?? ''
		};
	}, noteIndex);
}

// CST path of the block holding the current DOM caret — the observable oracle for
// "the caret landed in the title". Reads the focused contenteditable's wrapper.
async function activeBlockPath(page: Page): Promise<number[] | null> {
	return page.evaluate(() => {
		const el = document.activeElement?.closest('[data-block-path]');
		const attr = el?.getAttribute('data-block-path');
		return attr ? (JSON.parse(attr) as number[]) : null;
	});
}

async function capturedErrors(page: Page): Promise<string[]> {
	return page.evaluate(() => (window as any).__test.getCapturedErrors());
}

async function stateConsistencyViolations(page: Page): Promise<unknown[]> {
	return page.evaluate(() => (window as any).__test.auditBlockListStateConsistency());
}

// Paragraph above + a titled callout. Top-level: [0]=para "Above",
// [1]=callout; callout children: [1,0]=title "Title", [1,1]=para "Body".
const FIXTURE = 'Above\n\n:::note Title\nBody\n:::\n';

test.describe('Fork-A spike — reserved child-0 chrome (:::note title)', () => {
	let editor: PluginsPage;
	// Commit-time invariants emit `[invariant:…]` console warnings — a channel the
	// structured `error` event (capturedErrors) does not carry. Watch it so a
	// violation on this page fails the gate instead of passing silently.
	let invariantWarnings: string[];

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		invariantWarnings = [];
		page.on('console', (m) => {
			const type = m.type();
			if ((type === 'warning' || type === 'error') && m.text().includes('[invariant:'))
				invariantWarnings.push(`${type}: ${m.text()}`);
		});
		await editor.gotoPlugins();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
	});

	test.afterEach(() => {
		expect(invariantWarnings).toEqual([]);
	});

	test('substrate: the title parses as a reserved child-0 note-title leaf', async ({ page }) => {
		await editor.loadContent(FIXTURE);
		const note = await readNote(page, 1);
		expect(note.kind).toBe('note');
		expect(note.rootCount).toBe(2);
		expect(note.childCount).toBe(2);
		expect(note.childKinds).toEqual(['note-title', 'paragraph']);
		expect(note.childTexts).toEqual(['Title', 'Body']);
		// Non-strip container: raw carries the title in the opener line, and the
		// document still round-trips (raw is authoritative for serialization).
		expect(note.raw).toBe(':::note Title\nBody\n:::\n');
		expect(await editor.bridge.getSource()).toBe(FIXTURE);
		expect(await capturedErrors(page)).toEqual([]);
	});

	// ── Gate 1 — selection parity ────────────────────────────────────────────

	test('Gate 1: keyboard Shift+ArrowDown paints one span from the paragraph into the title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		// Anchor mid-paragraph, extend to the paragraph end, then cross the boundary —
		// the span covers the paragraph tail AND reaches into the callout.
		await editor.focusBlock(0, 2);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		// The selection reaches the reserved chrome leaf (deep path [1, 0]), proving
		// cross-select-in with zero new selection machinery.
		expect(sel!.focus.path).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 1: pointer drag from the paragraph into the title is cross-block', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.dragFromTo([0], 2, [1, 0], 3);
		expect(await editor.bridge.isCrossBlockActive()).toBe(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		expect(sel!.focus.path).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 1 (edge): cross-select-in reaches child 0 even when the title is empty', async ({
		page
	}) => {
		// The default reserved slot: a callout whose author has not typed a title.
		await editor.loadContent('Above\n\n:::note\nBody\n:::\n');
		const seed = await readNote(page, 1);
		expect(seed.childKinds[0]).toBe('note-title');
		expect(seed.childTexts[0]).toBe('');

		await editor.focusBlock(0, 2);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		const sel = await editor.bridge.getSelectionPaths();
		expect(sel).not.toBeNull();
		expect(sel!.anchor.path).toEqual([0]);
		// An empty child-0 leaf is still a real selection endpoint.
		expect(sel!.focus.path).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 1: collapsing the cross-block selection lands the caret in the title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlock(0, 2);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);

		// Collapse to the focus edge (the title), then type — the character must land
		// in the child-0 leaf, proving it is a real caret target. (The note-title kind
		// survives the edit via contextDependentKind, characterized separately — this
		// gate is about the caret reaching path [1, 0].)
		await page.keyboard.press('ArrowRight');
		await editor.waitForCrossBlock(false);
		await editor.typeText('Z');
		await editor.bridge.waitForSource((s) => /:::note [^\n]*Z/.test(s));

		const note = await readNote(page, 1);
		expect(note.childTexts[0]).toContain('Z');
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 1: undo restores a title edit and lands the caret back in the title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await editor.typeText('!');
		await editor.bridge.waitForSourceContains(':::note Title!');
		await editor.waitForUndoBatchFlush();

		await editor.undo();
		await editor.bridge.waitForSourceContains(':::note Title\n');
		const note = await readNote(page, 1);
		expect(note.childTexts[0]).toBe('Title');
		// Undo's selection restore returns the caret to the title leaf.
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		expect(await capturedErrors(page)).toEqual([]);
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
		await editor.undo();
		await editor.bridge.waitForSourceNotContains('BodyQ');
		const note = await readNote(page, 1);
		expect(note.childTexts).toEqual(['Title', 'Body']);
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

	// ── Gate 4 — rangeDelete chrome wall ─────────────────────────────────────

	// Two body children so in-place truncation is distinguishable from an upward
	// merge, plus a trailing paragraph as an outside end anchor.
	const WALL_FIXTURE = 'Above\n\n:::note Title\nBody1\n\nBody2\n:::\n\nBelow\n';

	test('Gate 4a: Delete over a selection covering the whole title clears the chrome, never deleting it', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.dragFromTo([0], 2, [1, 0], 5);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::note\n');

		// The wall rule: "Above" keeps its head as its own paragraph, the fully
		// covered title survives as an EMPTY note-title (cleared, not deleted),
		// and the body never hoists into the opener line.
		const note = await readNote(page, 1);
		expect(note.rootCount).toBe(2);
		expect(note.childCount).toBe(2);
		expect(note.childKinds).toEqual(['note-title', 'paragraph']);
		expect(note.childTexts).toEqual(['', 'Body']);
		expect(note.raw).toBe(':::note\nBody\n:::\n');
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::note\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await editor.bridge.waitForSourceContains(':::note Title');
		expect(await editor.bridge.getSource()).toBe(FIXTURE);
	});

	test('Gate 4a (gesture parity): the historical Delete-into-title keyboard gesture no longer corrupts the chrome', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlock(0, 2);
		await page.keyboard.press('Shift+End');
		await page.keyboard.press('Shift+ArrowDown');
		await editor.waitForCrossBlock(true);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('Ab\n');

		// Sticky column lands the focus at title offset 0, so the range covers no
		// title text: the wall truncates "Above" in place and leaves the chrome
		// intact — where the pre-contract path deleted the title node and hoisted
		// "Body" into the opener line.
		const note = await readNote(page, 1);
		expect(note.childKinds).toEqual(['note-title', 'paragraph']);
		expect(note.childTexts).toEqual(['Title', 'Body']);
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::note Title\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 4b: partial title coverage keeps the tail in the chrome, never merged upward', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.dragFromTo([0], 2, [1, 0], 3);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::note le');

		const note = await readNote(page, 1);
		expect(note.childKinds).toEqual(['note-title', 'paragraph']);
		expect(note.childTexts).toEqual(['le', 'Body']);
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::note le\nBody\n:::\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 4c: chrome-between — start truncates, chrome clears, end body child keeps its tail in place', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([0], 2, [1, 1], 2);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains('dy1');

		const note = await readNote(page, 1);
		expect(note.childKinds).toEqual(['note-title', 'paragraph', 'paragraph']);
		expect(note.childTexts).toEqual(['', 'dy1', 'Body2']);
		expect(await editor.bridge.getSource()).toBe('Ab\n\n:::note\ndy1\n\nBody2\n:::\n\nBelow\n');
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// The cleared chrome cleared through an unshared copy (G1.9), so undo restores
		// the title at the CHILD level — not just the container's authoritative source
		// bytes, which `getSource` reads and would show even with a corrupted title node.
		await editor.undo();
		await editor.bridge.waitForSourceContains(':::note Title');
		expect((await readNote(page, 1)).childTexts[0]).toBe('Title');
		expect(await editor.bridge.getSource()).toBe(WALL_FIXTURE);
	});

	test('Gate 4d: start-in-chrome — title keeps its head, body deletes, container survives title-only', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([1, 0], 3, [2], 3);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::note Tit');

		const note = await readNote(page, 1);
		expect(note.childCount).toBe(1);
		expect(note.childKinds).toEqual(['note-title']);
		expect(note.childTexts).toEqual(['Tit']);
		expect(await editor.bridge.getSource()).toBe('Above\n\n:::note Tit\n:::\n\now\n');
		expect(await activeBlockPath(page)).toEqual([1, 0]);
		// Children 3→1 is the harsher BlockListState case: ids/refs must stay in
		// lockstep with the surviving children after the deep splice.
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		await editor.undo();
		await editor.bridge.waitForSourceContains('Body1');
		expect(await editor.bridge.getSource()).toBe(WALL_FIXTURE);
	});

	test('Gate 4e: a range strictly around the container still deletes it as a unit', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([0], 5, [2], 3);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceNotContains(':::note');

		expect(await editor.bridge.getSource()).toBe('Aboveow\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test("Gate 4f: a range ending exactly at the container's last byte also deletes it as a unit", async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([0], 5, [1, 2], 5);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceNotContains(':::note');

		expect(await editor.bridge.getSource()).toBe('Above\n\nBelow\n');
		// Root splice removing the whole container: the top-level BlockListState
		// stays in lockstep after the one-splice unit delete.
		expect(await stateConsistencyViolations(page)).toEqual([]);
		expect(await capturedErrors(page)).toEqual([]);

		// One-splice unit delete undoes cleanly back to the full container, children intact.
		await editor.undo();
		await editor.bridge.waitForSourceContains(':::note Title');
		expect(await editor.bridge.getSource()).toBe(WALL_FIXTURE);
		expect((await readNote(page, 1)).childTexts).toEqual(['Title', 'Body1', 'Body2']);
	});

	test('Gate 4g: a body-only range never fires the wall — type-over merges exactly like a blockquote', async ({
		page
	}) => {
		await editor.loadContent(WALL_FIXTURE);
		await editor.dragFromTo([1, 1], 2, [1, 2], 3);
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('BoZy2');

		const note = await readNote(page, 1);
		expect(note.childKinds).toEqual(['note-title', 'paragraph']);
		expect(note.childTexts).toEqual(['Title', 'BoZy2']);

		// Same gesture over an undeclared container: the generic path handles both
		// identically, proving the gate is scoped to declared chrome.
		await editor.loadContent('Above\n\n> Body1\n>\n> Body2\n\nBelow\n');
		await editor.dragFromTo([1, 0], 2, [1, 1], 3);
		await editor.typeSlowly('Z');
		await editor.bridge.waitForSourceContains('BoZy2');
		expect((await readNote(page, 1)).childTexts).toEqual(['BoZy2']);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 4h: an inside-only selection over the whole callout empties it to a blank title + blank body', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		// Drag from the title start through the body end — an inside-only range that
		// covers the entire subtree WITHOUT crossing the wall from outside. The wall
		// keeps the container alive: the title clears in place and the fully-covered
		// body truncates to an empty paragraph, so the reserved slot holds chrome (not
		// a bare paragraph) and G1.14 stays satisfied — the delete-all end state.
		await editor.dragFromTo([1, 0], 0, [1, 1], 4);
		await page.keyboard.press('Delete');
		await editor.waitForCrossBlock(false);
		await editor.bridge.waitForSourceContains(':::note\n');

		const note = await readNote(page, 1);
		expect(note.rootCount).toBe(2);
		expect(note.childCount).toBe(2);
		expect(note.childKinds).toEqual(['note-title', 'paragraph']);
		expect(note.childTexts).toEqual(['', '']);
		expect(await editor.bridge.getSource()).toBe('Above\n\n:::note\n\n:::\n');
		expect(await stateConsistencyViolations(page)).toEqual([]);
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
