import { test, expect } from '../../fixtures';
import { PluginsPage, readContainer, waitForContainer, roundTripStable } from './helpers';

// The generic `:::name` container: an unregistered directive falls back to
// `DirectiveContainerBlock`, which renders a dimmed read-only `:::name` marker over a nested
// editable BlockList. Same opaque-container machinery as the callout dogfood, so this mirrors
// callout-container.spec.ts.

const SEED = ':::foo\nhello\n:::\n';

test.describe('plugin container: generic :::name directive', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins();
	});

	test('unregistered :::foo renders as a directive container with a marker and editable body', async () => {
		await editor.loadContent(SEED);

		const state = await readContainer(editor.page);
		expect(state.kind).toBe('directiveContainer');
		expect(state.rootCount).toBe(1);
		expect(state.childCount).toBe(1);
		expect(state.childTexts).toEqual(['hello']);

		// The fence renders as a marker, not a raw-editable fallback line, and `hello`
		// is reachable in an editable body block.
		await expect(editor.page.locator('.directive-marker')).toHaveText(':::foo');
		await expect(
			editor.page.locator('.directive-block [contenteditable="true"]', { hasText: /^hello$/ })
		).toHaveCount(1);
	});

	test('typing into the body rebuilds the container raw and round-trips byte-for-byte', async ({
		page
	}) => {
		await editor.loadContent(SEED);

		await page.locator('.directive-block [contenteditable="true"]', { hasText: /^hello$/ }).click();
		await page.keyboard.press('End');
		await editor.typeText(' world');

		const state = await waitForContainer(page, 0, (s) => s.childTexts[0] === 'hello world');
		expect(state.rootCount).toBe(1);
		expect(state.childCount).toBe(1);
		// A within-paragraph edit: the container raw is regenerated from the body, so
		// getSource is byte-exact — a stale raw would still read the seed.
		expect(state.raw).toBe(':::foo\nhello world\n:::\n');
		expect(await editor.bridge.getSource()).toBe(':::foo\nhello world\n:::\n');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('Enter at the end of the body adds a second body block inside the container', async ({
		page
	}) => {
		await editor.loadContent(SEED);

		await page.locator('.directive-block [contenteditable="true"]', { hasText: /^hello$/ }).click();
		await page.keyboard.press('End');

		// Enter mid-container must grow the container's children, never the document
		// root — a broken container would push a sibling to the root (rootCount === 2).
		await page.keyboard.press('Enter');
		let state = await waitForContainer(page, 0, (s) => s.childCount === 2);
		expect(state.rootCount).toBe(1);

		await editor.typeText('second');
		state = await waitForContainer(page, 0, (s) => s.childTexts[1] === 'second');
		expect(state.rootCount).toBe(1);
		expect(state.childTexts).toEqual(['hello', 'second']);
		// The rebuild ran over ALL children — the new block reaches the container raw.
		expect(state.raw).toContain('second');
		expect(await roundTripStable(page)).toBe(true);
	});

	test('the :::foo marker is read-only chrome, not caret-editable', async ({ page }) => {
		await editor.loadContent(SEED);

		const marker = page.locator('.directive-marker');
		await expect(marker).toHaveCount(1);
		expect(await marker.getAttribute('contenteditable')).toBe('false');
		// It also sits outside every editable region, so a caret can't land in it.
		const outsideEditable = await page.evaluate(
			() =>
				document.querySelector('.directive-marker')?.closest('[contenteditable="true"]') === null
		);
		expect(outsideEditable).toBe(true);
	});
});
