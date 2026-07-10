import { test, expect } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// The generic `::name` leaf: a two-colon fence with no registered plugin falls
// back to `directiveLeaf`, a single editable line rendered through the built-in
// text surface with the `::name` fence dimmed as a `.md-marker` prefix. Unlike the
// container's read-only block marker, the whole line is one editable coordinate
// space (an edit that breaks the fence reparses to a paragraph). Mirrors
// directive-container.spec.ts: read the doc by CST path through `__test`, drive
// real keyboard.
class DirectivePage extends EditorPage {
	async gotoPlugins() {
		await this.page.goto('/test/plugins');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}
}

interface DocState {
	rootCount: number;
	kinds: string[];
	// Root-child raws, trailing newlines stripped so they read as visible text.
	texts: string[];
}

async function readDoc(page: Page): Promise<DocState> {
	return page.evaluate(() => {
		const doc = (window as any).__test.getDocument();
		const children = doc.children as { kind: string; raw?: string }[];
		return {
			rootCount: children.length,
			kinds: children.map((c) => c.kind),
			texts: children.map((c) => (c.raw ?? '').replace(/\n+$/, ''))
		};
	});
}

async function waitForDoc(
	page: Page,
	predicate: (s: DocState) => boolean,
	timeout = 2000
): Promise<DocState> {
	await page.waitForFunction(
		(predSrc) => {
			const doc = (window as any).__test.getDocument();
			const children = doc.children as { kind: string; raw?: string }[];
			const state = {
				rootCount: children.length,
				kinds: children.map((c) => c.kind),
				texts: children.map((c) => (c.raw ?? '').replace(/\n+$/, ''))
			};
			return new Function('s', `return (${predSrc})(s);`)(state);
		},
		predicate.toString(),
		{ timeout, polling: 16 }
	);
	return readDoc(page);
}

async function roundTripStable(page: Page): Promise<boolean> {
	return page.evaluate(() => (window as any).__test.roundTripStable());
}

test.describe('plugin leaf: generic ::name directive', () => {
	let editor: DirectivePage;

	test.beforeEach(async ({ page }) => {
		editor = new DirectivePage(page);
		await editor.gotoPlugins();
	});

	test('unregistered ::toc renders as a directive leaf with a dimmed marker and editable info', async ({
		page
	}) => {
		await editor.loadContent('::toc info\n');

		const state = await readDoc(page);
		expect(state.kinds[0]).toBe('directiveLeaf');
		expect(state.rootCount).toBe(1);

		// The fence is a dimmed `.md-marker`, the whole line editable — not a raw
		// fallback and not a read-only container marker.
		const marker = page.locator('.directive-leaf .md-marker');
		await expect(marker).toHaveText('::toc');
		const opacity = await marker.evaluate((el) => parseFloat(getComputedStyle(el).opacity));
		expect(opacity).toBeLessThan(1);

		const editable = page.locator('.directive-leaf[contenteditable="true"]');
		await expect(editable).toHaveCount(1);
		await expect(editable).toHaveText('::toc info');
	});

	test('typing at the end of the info updates the leaf raw and round-trips byte-for-byte', async ({
		page
	}) => {
		await editor.loadContent('::toc info\n');

		await page.locator('.directive-leaf[contenteditable="true"]').click();
		await page.keyboard.press('End');
		await editor.typeText(' more');

		const state = await waitForDoc(page, (s) => s.texts[0] === '::toc info more');
		expect(state.rootCount).toBe(1);
		expect(state.kinds).toEqual(['directiveLeaf']);
		expect(await editor.bridge.getSource()).toBe('::toc info more\n');
		expect(await roundTripStable(page)).toBe(true);
		// The fence stays dimmed after the edit — only the info grew.
		await expect(page.locator('.directive-leaf .md-marker')).toHaveText('::toc');
	});

	test('Enter at the end of the info adds a paragraph sibling, not a second in-leaf line', async ({
		page
	}) => {
		await editor.loadContent('::toc info\n');

		await page.locator('.directive-leaf[contenteditable="true"]').click();
		await page.keyboard.press('End');
		await page.keyboard.press('Enter');

		// A new paragraph joins the ROOT (rootCount 2), and the leaf keeps its single
		// line — a broken Enter would either grow the leaf's own raw or stay at one block.
		let state = await waitForDoc(page, (s) => s.rootCount === 2);
		expect(state.kinds).toEqual(['directiveLeaf', 'paragraph']);
		expect(state.texts[0]).toBe('::toc info');

		await editor.typeText('below');
		state = await waitForDoc(page, (s) => s.texts[1] === 'below');
		expect(state.rootCount).toBe(2);
		expect(state.kinds).toEqual(['directiveLeaf', 'paragraph']);
		expect(state.texts[0]).toBe('::toc info');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('the leaf is not-mergeable: Backspace at its start does not merge it into the block above', async ({
		page
	}) => {
		await editor.loadContent('intro\n\n::toc info\n');

		let state = await readDoc(page);
		expect(state.rootCount).toBe(2);
		expect(state.kinds).toEqual(['paragraph', 'directiveLeaf']);

		await page.locator('.directive-leaf[contenteditable="true"]').click();
		await page.keyboard.press('Home');
		await page.keyboard.press('Backspace');

		// Not-mergeable: Backspace moves focus but never concatenates — a merge would
		// collapse the two blocks into one and rewrite the source.
		await editor.waitForNoSourceMutation();
		state = await readDoc(page);
		expect(state.rootCount).toBe(2);
		expect(state.kinds).toEqual(['paragraph', 'directiveLeaf']);
		expect(await editor.bridge.getSource()).toBe('intro\n\n::toc info\n');
	});
});
