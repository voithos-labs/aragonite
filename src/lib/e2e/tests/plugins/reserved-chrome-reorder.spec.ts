import { test, expect } from '../../fixtures';
import { type Locator, type Page } from '@playwright/test';
import { PluginsPage, readContainer, readDoc } from './helpers';

// Opaque plugin containers (admonition, <details>, callout) refuse reordering inside them: the
// resolver returns nothing to move, so dragging or the keyboard does nothing there and the inner
// BlockList draws no drag handle on the title row or on any body row. The container itself is
// still a top-level thing to reorder. A handle exists only where something can be reordered,
// since hover only changes its opacity, so counting handles is what the tests read.

// The handle is a direct child of the block-host wrapper, and the `>` combinator keeps a row's own
// handle apart from any nested one.
function ownHandle(page: Page, path: number[]): Locator {
	return page.locator(`[data-block-path='${JSON.stringify(path)}'] > .block-drag-handle`);
}

// Bring up a top-level container's own handle and drag it with a real pointer to a drop target.
// Hovering anywhere in the container brings up its handle once no inner row can be reordered,
// which is what the `:not(:has(.reorder-host:hover))` rule gives.
async function dragContainerHandle(
	page: Page,
	containerKind: string,
	dstText: string,
	below: boolean
): Promise<void> {
	const host = page.locator(`.block-host[data-block-kind="${containerKind}"]`).first();
	await host.hover();
	// The glyph, not the middle of the full-height strip: that is where a hand goes, and on a tall
	// container the strip's middle is a long way from anything the user can see.
	const hb = await host.locator(':scope > .block-drag-handle svg').boundingBox();
	if (!hb) throw new Error(`no own handle for ${containerKind}`);
	// `.last()`: an HTML container's host reports the raw text of the region it opened, its end
	// included, so `.first()` would pick the container being dragged instead of the block below.
	const db = await page.locator('.block-host', { hasText: dstText }).last().boundingBox();
	if (!db) throw new Error('missing drop-target box');
	await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
	await page.mouse.down();
	await page.mouse.move(db.x + db.width / 2, below ? db.y + db.height - 2 : db.y + 2, {
		steps: 14
	});
	await page.mouse.up();
}

const ADMONITION = ':::tip Pro tip\nBody one\n\nBody two\n:::\n';
// Siblings above and below, so a reorder aimed at the wrong list would move the container to a
// different document index; a container on its own would simply do nothing and hide that. The
// admonition sits at document index 1, its body one at [1, 1].
const ADMONITION_SIBLINGS = 'TOP\n\n:::tip Pro tip\nBody one\n\nBody two\n:::\n\nTAIL\n';
const DETAILS = '<details open>\n<summary>Summary</summary>\n\nDetails body\n\n</details>\n';

test.describe('opaque containers decline nested reorder', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	// ── Bug 2: no drag handle on the title row or the body rows ───────────────

	// A note is prose, so it has no handle of its own either (`components/drag-handle.ts`); what
	// this pins is that nothing inside it can be reordered. The `<details>` case below is the
	// container that does keep a handle, so together they separate "refuses reordering inside"
	// from "has no handle at all".
	test('an admonition renders no handle on its chrome, its body rows, or itself', async ({
		page
	}) => {
		await editor.loadContent(ADMONITION);
		const admonition = await readContainer(page, 0);
		expect(admonition.kind).toBe('admonition');
		expect(admonition.childKinds).toEqual(['admonition-title', 'paragraph', 'paragraph']);

		await expect(ownHandle(page, [0, 0])).toHaveCount(0); // title chrome
		await expect(ownHandle(page, [0, 1])).toHaveCount(0); // body one
		await expect(ownHandle(page, [0, 2])).toHaveCount(0); // body two
		await expect(ownHandle(page, [0])).toHaveCount(0); // and the note itself: prose
	});

	test('the <details> summary chrome row renders no handle', async ({ page }) => {
		await editor.loadContent(DETAILS);
		const details = await readContainer(page, 0);
		expect(details.kind).toBe('details');
		expect(details.childKinds[0]).toBe('details-summary');

		await expect(ownHandle(page, [0, 0])).toHaveCount(0);
		await expect(ownHandle(page, [0])).toHaveCount(1);
	});

	// ── Bug 1: the shared resolver declines, so the keyboard does nothing ─────

	test('Alt+ArrowUp / Alt+ArrowDown on an admonition body paragraph is a byte-exact no-op', async ({
		page
	}) => {
		await editor.loadContent(ADMONITION_SIBLINGS); // [0]=TOP, [1]=admonition, [2]=TAIL
		const before = await editor.bridge.getSource();

		await editor.focusBlockAtPath([1, 1], 0); // caret in "Body one"
		await editor.pressDeclined('Alt+ArrowUp');
		expect(await editor.bridge.getSource()).toBe(before);

		await editor.focusBlockAtPath([1, 1], 0);
		await editor.pressDeclined('Alt+ArrowDown');
		expect(await editor.bridge.getSource()).toBe(before);

		// The container never moved to another document index: the order is preserved.
		expect((await readDoc(page)).kinds).toEqual(['paragraph', 'admonition', 'paragraph']);
	});

	test('a declined Alt+Arrow pushes no undo entry the next Ctrl+Z would consume', async ({
		page
	}) => {
		await editor.loadContent(ADMONITION_SIBLINGS);

		await editor.focusBlockAtPath([1, 1], 0);
		await page.keyboard.press('End');
		await page.keyboard.type('X'); // a real edit to undo
		await editor.bridge.waitForSourceContains('Body oneX');

		await editor.pressDeclined('Alt+ArrowUp'); // must push no phantom entry

		await editor.undo(); // undoes the typed X, not a phantom reorder
		await editor.bridge.waitForSourceContains('Body one');
		expect(await editor.bridge.getSource()).not.toContain('Body oneX');
	});

	// ── Regression: the container itself still reorders at document level ─────

	// `<details>` rather than the admonition: a note has no handle, and this is the half that
	// needs one, since the container is still something its own handle drags.
	test('dragging the details own handle still reorders it past a sibling', async ({ page }) => {
		await editor.loadContent(`${DETAILS}\nTAIL\n`); // [0]=details, [1]=TAIL
		await dragContainerHandle(page, 'details', 'TAIL', true);

		await editor.bridge.waitForSourceMatches(/TAIL[\s\S]*<details/);
		expect(await editor.bridge.getBlockCount()).toBe(2); // no drop or duplication
	});
});
