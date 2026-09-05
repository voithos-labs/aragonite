import { test, expect } from '../../fixtures';
import { PluginsPage, readContainer, activeBlockPath, capturedErrors } from './helpers';

/**
 * The GFM footnote definition as a strip container in the listItem mold — the definition side of
 * the first-party footnotes plugin. This gate proves the three things a unit test cannot see: the
 * ambient `[^label]: ` marker renders as a dimmed prefix on the body, a body edit rebuilds the
 * container raw live, and a Backspace at the body's start unwraps the note the way every other
 * marker-bearing container does while the block below it never merges in.
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

	test('Backspace at the body start unwraps the note into a bare paragraph', async ({ page }) => {
		await editor.focusBlockAtPath([1, 0], 0); // body start, just after the ambient marker
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('\n\nThe note body.\n');

		expect(await editor.bridge.getSource()).toBe(
			'A note reference [^a] in prose.\n\nThe note body.\n'
		);
		const lifted = await readContainer(page, 1);
		expect(lifted.kind).toBe('paragraph');
		await expect.poll(() => activeBlockPath(page)).toEqual([1]);
		// Numbering is over references, not definitions, so the now-orphaned reference keeps
		// its number and renders rather than throwing.
		await expect(page.locator('.footnote-ref')).toHaveText('1');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('one undo puts the unwrapped note back under its marker', async ({ page }) => {
		await editor.focusBlockAtPath([1, 0], 0);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('\n\nThe note body.\n');

		await editor.undo();
		await editor.bridge.waitForSourceContains('[^a]: The note body.\n');
		expect(await editor.bridge.getSource()).toBe(SEED);
		expect((await readContainer(page, 1)).kind).toBe('footnote-def');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a Backspace in the second body block merges it into the first', async ({ page }) => {
		await editor.loadContent('[^a]: First.\n\n    Second.\n');
		await editor.focusBlockAtPath([0, 1], 0);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('First.Second.');

		// The marker stays: only the first body block's Backspace reaches the unwrap arm.
		expect(await editor.bridge.getSource()).toBe('[^a]: First.Second.\n');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('the first of two body blocks lifts out and the marker keeps the rest', async ({ page }) => {
		await editor.loadContent('[^a]: First.\n\n    Second.\n');
		await editor.focusBlockAtPath([0, 0], 0);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceContains('First.\n\n[^a]: Second.\n');

		expect(await editor.bridge.getSource()).toBe('First.\n\n[^a]: Second.\n');
		const def = await readContainer(page, 1);
		expect(def.kind).toBe('footnote-def');
		expect(def.childTexts).toEqual(['Second.']);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a Backspace in the paragraph below the note leaves the bytes alone', async ({ page }) => {
		await editor.loadContent('[^a]: The note body.\n\nAfter.\n');
		await editor.focusBlockAtPath([1], 0);
		await page.keyboard.press('Backspace');
		await editor.waitForNoSourceMutation();

		// A note is leaf-like outward: the keystroke moves the caret into the body rather than
		// turning the paragraph below into note text.
		expect(await editor.bridge.getSource()).toBe('[^a]: The note body.\n\nAfter.\n');
		await expect.poll(() => activeBlockPath(page)).toEqual([0, 0]);
		await expect
			.poll(() => editor.bridge.getSelection())
			.toMatchObject({ focus: { path: [0, 0], offset: 14 } });
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
