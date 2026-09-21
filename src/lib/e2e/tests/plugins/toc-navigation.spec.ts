import { test, expect } from '../../fixtures';
import type { Locator } from '@playwright/test';
import { PluginsPage, activeBlockPath, blockView, tocEntry } from './helpers';
import { capturePageErrors } from '../../page-probes';

/**
 * The `[[toc]]` outline (requirements/plugins/toc-navigation.md): entries indent by heading level
 * and navigate when clicked, in every presentation mode, including to a heading that is not
 * mounted. How the list is derived from the `document` prop is covered in `toc-document-prop`;
 * this spec covers the hierarchy and the navigation. Every fixture puts `[[toc]]` at block 0 so
 * the entries have a stable locator.
 */

// A capped viewport makes the editor a real scroll container, so a heading far down stays
// unmounted and a navigation click has to mount it and scroll it into view.
test.use({ viewport: { width: 1000, height: 700 } });

class TocNavPage extends PluginsPage {
	get render(): Locator {
		return this.page.locator("[data-block-path='[0]'] .toc-block-render");
	}
	get source(): Locator {
		return this.page.locator("[data-block-path='[0]'] .toc-block-source");
	}
	items(): Locator {
		return this.page.locator("[data-block-path='[0]'] .toc-block-item");
	}
	entry(label: string): Locator {
		return tocEntry(this.page, label);
	}
	async load(md: string): Promise<void> {
		await this.gotoPlugins('toc');
		await this.loadContent(md);
		await expect(this.render).toBeVisible();
	}
}

// A tall document: `[[toc]]` at the top, then an h1 and h2 among filler, an h3 far below that is
// unmounted at load, then a tail. targetIndex is that deep heading's block index.
function navDoc(): { md: string; targetIndex: number } {
	const parts = ['[[toc]]', '# Intro Heading'];
	for (let i = 0; i < 15; i++) parts.push(`Intro paragraph ${i} with enough words to fill a line.`);
	parts.push('## Middle Heading');
	for (let i = 0; i < 130; i++) parts.push(`Body paragraph ${i} with enough words to fill a line.`);
	const targetIndex = parts.length;
	parts.push('### Deep Target Heading');
	for (let i = 0; i < 40; i++) parts.push(`Tail paragraph ${i} with enough words to fill a line.`);
	return { md: parts.join('\n\n') + '\n', targetIndex };
}

test.describe('toc outline: hierarchy', () => {
	let editor: TocNavPage;
	test.beforeEach(async ({ page }) => {
		editor = new TocNavPage(page);
	});

	test('indents entries by heading level via a per-level class, keeping <ol>', async () => {
		await editor.load('[[toc]]\n\n# A\n\n## B\n\n### C\n');
		await expect(editor.items()).toHaveText(['A', 'B', 'C']);
		await expect(editor.entry('A')).toHaveClass(/toc-block-level-1/);
		await expect(editor.entry('B')).toHaveClass(/toc-block-level-2/);
		await expect(editor.entry('C')).toHaveClass(/toc-block-level-3/);
		await expect(editor.page.locator("[data-block-path='[0]'] ol")).toHaveCount(1);
	});

	test('lists a heading nested inside a blockquote', async () => {
		await editor.load('[[toc]]\n\n# Top\n\n> ## Quoted\n');
		await expect(editor.items()).toHaveText(['Top', 'Quoted']);
	});
});

test.describe('toc outline: click-to-navigate', () => {
	let editor: TocNavPage;
	let target: number;
	test.beforeEach(async ({ page }) => {
		editor = new TocNavPage(page);
		const doc = navDoc();
		target = doc.targetIndex;
		await editor.load(doc.md);
	});

	test('clicking a windowed-out entry mounts and scrolls its heading into view', async ({
		page
	}) => {
		const errors = capturePageErrors(page);
		// Precondition: the deep heading is not mounted.
		await expect(page.locator(`[data-block-path='[${target}]']`)).toHaveCount(0);

		await editor.entry('Deep Target Heading').click();
		await editor.waitForRenderFlush();

		// Scrolling to the target mounts it in view, and the outline block at the top unmounts on
		// the way, which is why the short-document case below pins that nothing opens.
		await expect.poll(() => blockView(page, [target])).toEqual({ mounted: true, inView: true });
		expect(errors).toEqual([]);
	});

	test('navigates in reading mode, placing the selection with no editable target', async ({
		page
	}) => {
		await editor.setPresentationMode('reading');
		await expect(page.locator(`[data-block-path='[${target}]']`)).toHaveCount(0);

		await editor.entry('Deep Target Heading').click();
		await editor.waitForRenderFlush();

		await expect.poll(() => blockView(page, [target])).toEqual({ mounted: true, inView: true });
		// Reading mode turns contenteditable off, so no block can hold the caret as activeElement,
		// and the browser's own range is how the test sees the selection land, which makes the
		// navigation's write the same in both modes. Offset 4 is the first reachable offset past
		// the hidden `### `, since every placement is clamped (G4.36), reading mode included.
		expect(await editor.bridge.getSelection()).toEqual({
			anchor: { path: [target], offset: 4 },
			focus: { path: [target], offset: 4 }
		});
	});

	// Entries are real `<button>`s: tab-focusable, activating on Enter/Space. Keyboard
	// navigation is view-only, so it must work in reading mode exactly as in source.
	for (const mode of ['source', 'reading'] as const) {
		test(`keyboard: focusing an entry and pressing Enter scrolls its heading into view (${mode} mode)`, async ({
			page
		}) => {
			if (mode === 'reading') {
				await editor.setPresentationMode('reading');
			}
			const errors = capturePageErrors(page);
			await expect(page.locator(`[data-block-path='[${target}]']`)).toHaveCount(0);

			const entry = editor.entry('Deep Target Heading');
			await entry.focus();
			await expect(entry).toBeFocused();
			await page.keyboard.press('Enter');
			await editor.waitForRenderFlush();

			await expect.poll(() => blockView(page, [target])).toEqual({ mounted: true, inView: true });
			expect(errors).toEqual([]);
		});
	}

	test('rapid clicks on two entries settle on the last target without stranding', async ({
		page
	}) => {
		const errors = capturePageErrors(page);
		// Click the middle entry and then immediately the deep one: the clicks run in order, so
		// the last one wins and no overlapping scroll strands it.
		await editor.entry('Middle Heading').click();
		await editor.entry('Deep Target Heading').click();
		await editor.waitForRenderFlush();

		await expect.poll(() => blockView(page, [target])).toEqual({ mounted: true, inView: true });
		expect(errors).toEqual([]);
	});

	// Navigating places the caret, so the editor's own chords reach the document straight
	// afterwards instead of dying on the entry `<button>` that still had focus. Typing is the
	// same fact as the user sees it.
	test('the caret lands in the target heading, so the next keystroke edits it', async ({
		page
	}) => {
		const errors = capturePageErrors(page);

		await editor.entry('Deep Target Heading').click();
		await expect.poll(() => activeBlockPath(page)).toEqual([target]);

		await page.keyboard.type('X');
		expect(await editor.bridge.getSource()).toContain('X### Deep Target Heading');
		expect(errors).toEqual([]);
	});
});

test.describe('toc outline: gesture ownership (entry vs block)', () => {
	let editor: TocNavPage;
	test.beforeEach(async ({ page }) => {
		editor = new TocNavPage(page);
		// A short document: everything stays mounted, so navigating scrolls nowhere and the block
		// never unmounts, which isolates whether the source opens.
		await editor.load('[[toc]]\n\n# A\n\n## B\n');
	});

	test('clicking an entry navigates without revealing the raw source', async () => {
		await editor.entry('A').click();
		await expect(editor.source).toHaveCount(0);
		await expect(editor.render).toBeVisible();
	});

	test('clicking the block non-entry area reveals the raw source in source mode', async () => {
		// The left edge of the rendered block, its border and padding, away from any entry text,
		// so the pointerdown that opens the source fires instead of an entry navigating.
		await editor.render.click({ position: { x: 2, y: 2 } });
		await expect(editor.source).toHaveCount(1);
	});

	test('in reading mode a non-entry click is inert — no reveal, no navigation', async ({
		page
	}) => {
		await editor.setPresentationMode('reading');
		const errors = capturePageErrors(page);

		await editor.render.click({ position: { x: 2, y: 2 } });
		await editor.waitForRenderFlush();

		// Reading mode stops the source from opening, since that handler returns early on
		// isReading, and a click away from an entry reaches no button, so the outline just stays.
		await expect(editor.source).toHaveCount(0);
		await expect(editor.render).toBeVisible();
		expect(errors).toEqual([]);
	});
});
