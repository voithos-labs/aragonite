import { test, expect } from '../../fixtures';
import { PluginsPage, readContainer, activeBlockPath, capturedErrors } from './helpers';

/**
 * The GFM footnote definition as a strip container in the listItem mold — the definition side of
 * the first-party footnotes plugin. This gate proves the three things a unit test cannot see: the
 * ambient `[^label]: ` marker renders as a dimmed prefix on the body, a body edit rebuilds the
 * container raw live, and a Backspace at the body's start delegates upward instead of unwrapping
 * the container into loose paragraphs (the not-mergeable contract).
 */
const SEED = 'A note reference [^a] in prose.\n\n[^a]: The note body.\n';

test.describe('plugin container: footnote definition', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('footnotes');
	});

	test('substrate: mounts the FootnoteDefinition container with a paragraph body', async ({
		page
	}) => {
		const def = await readContainer(page, 1);
		expect(def.kind).toBe('footnote-def');
		expect(def.childKinds).toEqual(['paragraph']);
		await expect(page.locator('.footnote-def')).toBeVisible();
		expect(await editor.bridge.getSource()).toBe(SEED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('renders the [^a]: marker as a dimmed ambient prefix before the body', async ({ page }) => {
		// The definition's only marker is the ambient prefix (the body text carries no
		// inline syntax), so the block reads "[^a]: The note body." with the marker dimmed.
		await expect(page.locator('.footnote-def .md-marker').first()).toHaveText('[^a]:');
		await expect(page.locator('.footnote-def')).toContainText('[^a]: The note body.');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('editing the body rebuilds the container raw and round-trips', async ({ page }) => {
		await editor.focusBlockAtPath([1, 0], 14); // end of "The note body."
		await editor.typeText(' more');
		await editor.bridge.waitForSourceContains('[^a]: The note body. more\n');

		expect(await editor.bridge.getSource()).toBe(
			'A note reference [^a] in prose.\n\n[^a]: The note body. more\n'
		);
		const def = await readContainer(page, 1);
		expect(def.kind).toBe('footnote-def');
		// The container's OWN raw rebuilt (marker + edited body) — childTexts alone stays
		// green on a stale container raw.
		expect(def.raw).toBe('[^a]: The note body. more\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('one undo restores the seed bytes after a body edit', async ({ page }) => {
		await editor.focusBlockAtPath([1, 0], 14);
		await editor.typeText('X');
		await editor.bridge.waitForSourceContains('The note body.X');

		await editor.undo();
		await editor.bridge.waitForSourceContains('The note body.\n');
		expect(await editor.bridge.getSource()).toBe(SEED);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Backspace at the body start delegates up, not into paragraph soup', async ({ page }) => {
		await editor.focusBlockAtPath([1, 0], 0); // body start, just after the ambient marker
		await page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();

		// not-mergeable: the definition stays one footnote-def block (never a run of loose
		// paragraphs), the bytes are untouched, and the caret lands on the prose above.
		expect(await editor.bridge.getSource()).toBe(SEED);
		const def = await readContainer(page, 1);
		expect(def.kind).toBe('footnote-def');
		expect(def.childKinds).toEqual(['paragraph']);
		await expect.poll(() => activeBlockPath(page)).toEqual([0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('typing [^b]: body into a fresh paragraph forms the container live', async ({ page }) => {
		// Split a new empty paragraph off the prose, then type a definition into it: the
		// content reparse flips the block to a footnote definition with one paragraph child.
		await editor.focusBlockEnd(0);
		await page.keyboard.press('Enter');
		await editor.waitForRenderFlush();

		// Per keystroke: the `[^b]` prefix mounts a transient inline reference widget on its
		// closing `]`, and the body is typed against that widget's trailing edge before the reparse
		// resolves the line to a definition marker. The separating space is not typed — `:`
		// auto-completes the marker to `[^b]: `, which the atomic `insertText` this replaced never
		// ran.
		await editor.typeSlowly('[^b]:');
		await editor.typeSlowly('brand new note');
		await editor.bridge.waitForSourceContains('[^b]: brand new note');

		const def = await readContainer(page, 1);
		expect(def.kind).toBe('footnote-def');
		expect(def.childKinds).toEqual(['paragraph']);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
