import { test, expect } from '../../fixtures';
import { type Locator, type Page } from '@playwright/test';
import { PluginsPage, readContainer, readDoc } from './helpers';

// Opaque plugin containers (admonition, <details>, callout) decline nested reorder at their
// boundary: the resolver returns no unit, so drag/keyboard reorder inside them is a no-op and the
// inner BlockList renders no drag handle on the reserved chrome row OR the body rows. The container
// itself stays a top-level reorder unit. Handles are existence-gated on being a reorder unit
// (opacity only reveals on hover), so handle COUNT is the affordance oracle.

// The handle is a direct child of the block-host wrapper; the `>` combinator isolates a row's OWN
// handle from any nested descendants'.
function ownHandle(page: Page, path: number[]): Locator {
	return page.locator(`[data-block-path='${JSON.stringify(path)}'] > .block-drag-handle`);
}

// Reveal + real-pointer drag of a top-level container's OWN handle to a drop target. Hovering
// anywhere in the container reveals its own grip once no inner row is a reorder unit (the
// `:not(:has(.reorder-host:hover))` rule), which is exactly the post-fix state.
async function dragContainerHandle(
	page: Page,
	containerKind: string,
	dstText: string,
	below: boolean
): Promise<void> {
	const host = page.locator(`.block-host[data-block-kind="${containerKind}"]`).first();
	await host.hover();
	// The glyph, not the middle of the full-height strip: that is where a hand goes, and the
	// strip's middle on a tall container is a long way from anything the user can see.
	const hb = await host.locator(':scope > .block-drag-handle svg').boundingBox();
	if (!hb) throw new Error(`no own handle for ${containerKind}`);
	// `.last()`: an HTML container's host reports the raw text of the region it opened, tail
	// included, so `.first()` picks the container being dragged instead of the block below it.
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
// Siblings ABOVE and below so a mis-scoped reorder would teleport the container to a different
// document index — a lone container clamps to a no-op and would hide the teleport. Admonition sits
// at doc index 1, body one at [1, 1].
const ADMONITION_SIBLINGS = 'TOP\n\n:::tip Pro tip\nBody one\n\nBody two\n:::\n\nTAIL\n';
const DETAILS = '<details open>\n<summary>Summary</summary>\n\nDetails body\n\n</details>\n';

test.describe('opaque containers decline nested reorder', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	// ── Bug 2 — no drag affordance on chrome or body rows ─────────────────────

	// A note is prose, so it carries no grip of its own either (`components/drag-handle.ts`);
	// what this pins is that nothing INSIDE it becomes a reorder unit. The `<details>` case
	// below is the container that does keep a grip, so the two together still separate
	// "declines nested reorder" from "has no grip at all".
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

	// ── Bug 1 — the shared resolver declines, so keyboard reorder is a no-op ───

	test('Alt+ArrowUp / Alt+ArrowDown on an admonition body paragraph is a byte-exact no-op', async ({
		page
	}) => {
		await editor.loadContent(ADMONITION_SIBLINGS); // [0]=TOP, [1]=admonition, [2]=TAIL
		const before = await editor.bridge.getSource();

		await editor.focusBlockAtPath([1, 1], 0); // caret in "Body one"
		await page.keyboard.press('Alt+ArrowUp');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);

		await editor.focusBlockAtPath([1, 1], 0);
		await page.keyboard.press('Alt+ArrowDown');
		await editor.waitForNoSourceMutation();
		expect(await editor.bridge.getSource()).toBe(before);

		// The container never teleported to another document index: order is preserved.
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

		await page.keyboard.press('Alt+ArrowUp'); // declined — must push no phantom entry
		await editor.waitForNoSourceMutation();

		await editor.undo(); // undoes the typed X, not a phantom reorder
		await editor.bridge.waitForSourceContains('Body one');
		expect(await editor.bridge.getSource()).not.toContain('Body oneX');
	});

	// ── Regression — the container itself still reorders at document level ─────

	// `<details>` rather than the admonition: a note carries no grip, and this is the half that
	// needs one — the container is still a top-level unit its own handle drags.
	test('dragging the details own handle still reorders it past a sibling', async ({ page }) => {
		await editor.loadContent(`${DETAILS}\nTAIL\n`); // [0]=details, [1]=TAIL
		await dragContainerHandle(page, 'details', 'TAIL', true);

		await editor.bridge.waitForSourceMatches(/TAIL[\s\S]*<details/);
		expect(await editor.bridge.getBlockCount()).toBe(2); // no drop or duplication
	});
});
