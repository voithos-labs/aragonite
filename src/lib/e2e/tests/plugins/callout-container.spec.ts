import { test, expect, type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// The plugins harness reuses the editor demo's probe surface but seeds a single
// `:::note` callout; only the route differs, so a thin subclass overriding goto
// keeps every real-interaction helper (typeText, undo, waitForUndoBatchFlush).
class PluginsPage extends EditorPage {
	async gotoPlugins() {
		await this.page.goto('/test/plugins');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

interface CalloutState {
	rootCount: number;
	kind: string;
	childCount: number;
	childTexts: string[];
	// The callout node's OWN raw — the value rebuildCalloutRaw must regenerate from
	// children after every structural edit. childTexts (leaf raws, edited directly)
	// and roundTripStable (self-consistency of the emitted source) both stay green on
	// a stale container raw; only this asserts the rebuild actually ran.
	raw: string;
}

// Read the callout by CST path through the bridge: document root child [0] is the
// callout; its children are the paragraphs the edits must move. Trailing newlines
// are stripped so childTexts read as the visible text.
async function readCallout(page: Page): Promise<CalloutState> {
	return page.evaluate(() => {
		const doc = (window as any).__test.getDocument();
		const note = doc.children[0];
		return {
			rootCount: doc.children.length,
			kind: note?.kind ?? '',
			childCount: note?.children?.length ?? 0,
			childTexts: (note?.children ?? []).map((c: { raw?: string }) =>
				(c.raw ?? '').replace(/\n+$/, '')
			),
			raw: note?.raw ?? ''
		};
	});
}

async function waitForCallout(
	page: Page,
	predicate: (s: CalloutState) => boolean,
	timeout = 2000
): Promise<CalloutState> {
	await page.waitForFunction(
		(predSrc) => {
			const doc = (window as any).__test.getDocument();
			const note = doc.children[0];
			const state = {
				rootCount: doc.children.length,
				kind: note?.kind ?? '',
				childCount: note?.children?.length ?? 0,
				childTexts: (note?.children ?? []).map((c: { raw?: string }) =>
					(c.raw ?? '').replace(/\n+$/, '')
				),
				raw: note?.raw ?? ''
			};
			return new Function('s', `return (${predSrc})(s);`)(state);
		},
		predicate.toString(),
		{ timeout, polling: 16 }
	);
	return readCallout(page);
}

async function roundTripStable(page: Page): Promise<boolean> {
	return page.evaluate(() => (window as any).__test.roundTripStable());
}

test.describe('plugin container: :::note callout editability', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	test('type, split, merge, and undo mutate the callout children, never the root', async ({
		page
	}) => {
		// Seed parsed as a real container, not a fallback paragraph. Child 0 is the
		// reserved editable title (Fork-A spike); the body paragraph follows it.
		let state = await readCallout(page);
		expect(state.kind).toBe('note');
		expect(state.rootCount).toBe(1);
		expect(state.childCount).toBe(2);
		expect(state.childTexts).toEqual(['Title', 'First']);

		// Type into the callout's body paragraph (child 1, NOT the title row).
		await page.locator('.callout-block [contenteditable="true"]', { hasText: /^First$/ }).click();
		await page.keyboard.press('End');
		await editor.typeText(' one');
		state = await waitForCallout(page, (s) => s.childTexts[1] === 'First one');
		expect(state.rootCount).toBe(1);
		expect(state.childCount).toBe(2);
		await editor.waitForUndoBatchFlush();

		// Split: Enter mid-body must add a THIRD child to the callout — a broken
		// container would instead grow the document root (rootCount === 2).
		await page.keyboard.press('Enter');
		state = await waitForCallout(page, (s) => s.childCount === 3);
		expect(state.rootCount).toBe(1);
		expect(state.childTexts[1]).toBe('First one');
		expect(await roundTripStable(page)).toBe(true);

		// Type into the new body child.
		await editor.typeText('two');
		const afterSplitTyping = await waitForCallout(page, (s) => s.childTexts[2] === 'two');
		expect(afterSplitTyping.rootCount).toBe(1);
		expect(afterSplitTyping.childCount).toBe(3);
		expect(afterSplitTyping.childTexts).toEqual(['Title', 'First one', 'two']);
		// The callout's own raw was rebuilt from ALL children — the title reaches the
		// opener line and 'two' the body only if rebuildCalloutRaw ran (a stale raw
		// would still read ':::note Title\nFirst\n:::'). The lazy-continuation shape
		// (single \n between the body paragraphs) matches blockquote split-at-end.
		expect(afterSplitTyping.raw).toBe(':::note Title\nFirst one\ntwo\n:::\n');
		expect(await editor.bridge.getSource()).toBe(':::note Title\nFirst one\ntwo\n:::\n');
		expect(await roundTripStable(page)).toBe(true);
		await editor.waitForUndoBatchFlush();

		// Merge: caret to the start of the last child (real Home), then Backspace
		// folds it back into the previous body paragraph — never into the title.
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');
		const afterMerge = await waitForCallout(page, (s) => s.childCount === 2);
		expect(afterMerge.rootCount).toBe(1);
		expect(afterMerge.childTexts).toEqual(['Title', 'First onetwo']);
		expect(afterMerge.raw).toBe(':::note Title\nFirst onetwo\n:::\n');
		expect(await editor.bridge.getSource()).toBe(':::note Title\nFirst onetwo\n:::\n');
		expect(await roundTripStable(page)).toBe(true);
		await editor.waitForUndoBatchFlush();

		// Undo the merge → back to the captured three-child split state, uncorrupted.
		await editor.undo();
		const undoneMerge = await waitForCallout(page, (s) => s.childCount === 3);
		expect(undoneMerge.rootCount).toBe(1);
		expect(undoneMerge.childTexts).toEqual(afterSplitTyping.childTexts);
		// Undo restored the container's own raw, not just the leaf children.
		expect(undoneMerge.raw).toBe(afterSplitTyping.raw);
		expect(await roundTripStable(page)).toBe(true);

		// Undo the "two" typing → the last body child loses its text, root untouched.
		await editor.undo();
		const undoneTyping = await waitForCallout(page, (s) => s.childTexts[2] === '');
		expect(undoneTyping.rootCount).toBe(1);
		expect(undoneTyping.childCount).toBe(3);
		expect(await roundTripStable(page)).toBe(true);
	});
});
