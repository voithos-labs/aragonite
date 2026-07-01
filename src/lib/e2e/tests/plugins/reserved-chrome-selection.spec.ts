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
 *   title moves focus instead of merging; title-start Backspace and Enter-in-title
 *   are characterized.
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

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
		await page.evaluate(() => (window as any).__test.startErrorCapture());
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
		// in the child-0 leaf, proving it is a real caret target. (Editing reparses
		// the kind away from note-title; that downgrade is characterized separately —
		// selection parity is about the caret reaching path [1, 0], not the kind.)
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

	test('Gate 2c (characterized): Enter in the title splits AND reparses it to paragraphs', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await page.keyboard.press('Enter');
		await editor.waitForBlockHostCount(5); // Above + callout + 3 callout children

		// Two characterized costs compound here:
		//  1. Reused TextEditableBlock binds Enter -> block.split (the closed CommandId
		//     union has no "descend to body" command), so the title splits.
		//  2. splitNode reparses each half; a bare title line has no recognizer, so
		//     BOTH halves fall to paragraph — the reserved chrome kind is lost.
		const note = await readNote(page, 1);
		expect(note.childCount).toBe(3);
		expect(note.childKinds).toEqual(['paragraph', 'paragraph', 'paragraph']);
		expect(note.childTexts[0]).toBe('Title');
		expect(note.childTexts[1]).toBe('');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2 (characterized): typing into the title reparses it away from note-title', async ({
		page
	}) => {
		await editor.loadContent(FIXTURE);
		await editor.focusBlockAtPath([1, 0], 5); // end of "Title"
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains(':::note TitleX');

		// updateNodeContent re-derives kind from raw on every content commit. A bare
		// title line reparses to paragraph, so the FIRST keystroke downgrades the
		// chrome. tableCell (a context-dependent kind with no recognizer) dodges this
		// via an explicit skip in updateNodeContent; reserved chrome needs the same
		// carve-out. The title still renders in the opener line (rebuildRaw reads
		// child-0 raw regardless of kind), so selection parity is unaffected.
		const note = await readNote(page, 1);
		expect(note.childKinds[0]).toBe('paragraph');
		expect(note.childTexts[0]).toBe('TitleX');
		expect(await editor.bridge.getSource()).toContain(':::note TitleX');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Gate 2d: the reserved chrome row keeps BlockListState ids/refs in lockstep across edits', async ({
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
});
