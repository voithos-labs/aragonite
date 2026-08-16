import { test, expect } from '../../fixtures';
import type { Locator, Page } from '@playwright/test';
import { PluginsPage, activeBlockPath } from './helpers';
import { capturePageErrors } from '../../page-probes';

/**
 * The `[[toc]]` outline (requirements/plugins/toc-navigation.md): entries indent by heading level
 * and click to navigate, in every presentation mode, including to a heading windowed out by virtual
 * rendering. The document-prop derivation and its pins live in `toc-document-prop`; this spec owns
 * the hierarchy + navigation layer. Every fixture puts `[[toc]]` at block 0 for a stable entry
 * locator.
 */

// Capped viewport → the editor is a real scroll container, so a deep heading windows
// out and a navigation click must mount and scroll it into view.
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
		return this.items().filter({ hasText: label });
	}
	async load(md: string): Promise<void> {
		await this.gotoPlugins('toc');
		await this.loadContent(md);
		await expect(this.render).toBeVisible();
	}
}

// In-view = the heading's block box intersects the editor viewport; independent of
// scrollTo's own check so the assertion isn't tautological.
function blockView(page: Page, index: number): Promise<{ mounted: boolean; inView: boolean }> {
	return page.evaluate((i) => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const er = editorEl.getBoundingClientRect();
		const block = document.querySelector(`[data-block-path='[${i}]']`) as HTMLElement | null;
		if (!block) return { mounted: false, inView: false };
		const br = block.getBoundingClientRect();
		return { mounted: true, inView: br.top < er.bottom && br.bottom > er.top };
	}, index);
}

// A tall document: `[[toc]]` at the top, then h1/h2 amid filler, a deep h3 far below
// (windowed out at load), then a tail. targetIndex is the deep heading's block index.
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
		// Precondition: the deep heading is windowed out (not mounted).
		await expect(page.locator(`[data-block-path='[${target}]']`)).toHaveCount(0);

		await editor.entry('Deep Target Heading').click();
		await editor.waitForRenderFlush();

		// Scrolling to the target mounts it in view; the top-of-doc toc block itself
		// windows out on the way, which is why "no reveal" is pinned on a short doc below.
		await expect.poll(() => blockView(page, target)).toEqual({ mounted: true, inView: true });
		expect(errors).toEqual([]);
	});

	test('navigates in reading mode, placing the selection with no editable target', async ({
		page
	}) => {
		await page.evaluate(() => (window as any).__test.setPresentationMode('reading'));
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await expect(page.locator(`[data-block-path='[${target}]']`)).toHaveCount(0);

		await editor.entry('Deep Target Heading').click();
		await editor.waitForRenderFlush();

		await expect.poll(() => blockView(page, target)).toEqual({ mounted: true, inView: true });
		// Reading mode turns contenteditable off, so no block can hold the caret as activeElement —
		// the native range is the observable that the selection landed, and it is what makes the
		// navigation's write the same write in both modes. Offset 4 is the landable start past the
		// hidden `### ` run: the caret door clamps every landing (G4.36), reading mode included.
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
				await page.evaluate(() => (window as any).__test.setPresentationMode('reading'));
				await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
			}
			const errors = capturePageErrors(page);
			await expect(page.locator(`[data-block-path='[${target}]']`)).toHaveCount(0);

			const entry = editor.entry('Deep Target Heading');
			await entry.focus();
			await expect(entry).toBeFocused();
			await page.keyboard.press('Enter');
			await editor.waitForRenderFlush();

			await expect.poll(() => blockView(page, target)).toEqual({ mounted: true, inView: true });
			expect(errors).toEqual([]);
		});
	}

	test('rapid clicks on two entries settle on the last target without stranding', async ({
		page
	}) => {
		const errors = capturePageErrors(page);
		// Click the middle entry then immediately the deep one: serialization means the
		// last click wins and no overlapping scroll strands it.
		await editor.entry('Middle Heading').click();
		await editor.entry('Deep Target Heading').click();
		await editor.waitForRenderFlush();

		await expect.poll(() => blockView(page, target)).toEqual({ mounted: true, inView: true });
		expect(errors).toEqual([]);
	});

	// A navigation lands the caret, so the editor's own chords reach the document straight
	// afterwards instead of dying on the entry `<button>` that still had focus. Typing is the
	// user-visible half of the same fact.
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
		// Short doc: everything stays mounted, so navigation is a no-op scroll and the
		// block never windows out — isolating the reveal/suppress behavior.
		await editor.load('[[toc]]\n\n# A\n\n## B\n');
	});

	test('clicking an entry navigates without revealing the raw source', async () => {
		await editor.entry('A').click();
		await expect(editor.source).toHaveCount(0);
		await expect(editor.render).toBeVisible();
	});

	test('clicking the block non-entry area reveals the raw source in source mode', async () => {
		// The render container's left edge (accent border / padding), away from any entry
		// text, so the block's reveal-on-pointerdown fires instead of an entry navigation.
		await editor.render.click({ position: { x: 2, y: 2 } });
		await expect(editor.source).toHaveCount(1);
	});

	test('in reading mode a non-entry click is inert — no reveal, no navigation', async ({
		page
	}) => {
		await page.evaluate(() => (window as any).__test.setPresentationMode('reading'));
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
		const errors = capturePageErrors(page);

		await editor.render.click({ position: { x: 2, y: 2 } });
		await editor.waitForRenderFlush();

		// Reading mode gates the reveal (the folded view's reveal handler early-returns on isReading),
		// and a non-entry click reaches no navigation button: the outline just stays shown.
		await expect(editor.source).toHaveCount(0);
		await expect(editor.render).toBeVisible();
		expect(errors).toEqual([]);
	});
});
