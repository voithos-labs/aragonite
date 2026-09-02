import { test, expect } from '../../fixtures';
import type { Locator } from '@playwright/test';
import { PluginsPage, activeBlockPath, blockView, capturedErrors, type Point } from './helpers';

/**
 * Jumping between a `[^label]` reference and its definition, both directions
 * (requirements/plugins/footnotes-navigation.md). The gesture is the link gesture: plain click
 * in reading mode, Ctrl/Cmd+click in the editing modes, where a plain click keeps meaning
 * "reveal the source to edit". The definitions sit past the window, so a jump that failed to
 * reveal leaves an unmounted target rather than an off-screen one.
 */

// Capped viewport → the editor is a real scroll container, so the definitions window out and
// a jump has to mount them.
test.use({ viewport: { width: 1000, height: 700 } });

const FILLER = 140;
// `[^zz]` is deliberately undefined: the widget claims the gesture whether or not it can
// answer it, so this is the reference that must do nothing at all.
const REFS = 'Body has [^a] and [^b] and [^zz] here.';
const SHORT_DOC = 'Body has [^a] and [^b] here.\n\n[^a]: First note.\n';

function navDoc(): { md: string; defA: number; defB: number } {
	const parts = [REFS];
	for (let i = 0; i < FILLER; i++) {
		parts.push(`Filler paragraph ${i} with enough words to fill a line.`);
	}
	const defA = parts.length;
	parts.push('[^a]: First note.', '[^b]: Second note.');
	return { md: parts.join('\n\n') + '\n', defA, defB: defA + 1 };
}

class FootnotePage extends PluginsPage {
	refs(block = 0): Locator {
		return this.page.locator(`[data-block-path='[${block}]'] .footnote-ref`);
	}
	backref(block: number): Locator {
		return this.page.locator(`[data-block-path='[${block}]'] .footnote-backref`);
	}
	async load(md: string): Promise<void> {
		await this.gotoPlugins('footnotes-ref');
		await this.loadContent(md);
	}
}

/** Aim point for the raw mouse steps a split gesture needs; `locator.click`'s `modifiers`
 *  holds one chord across the whole gesture, so it cannot express a chord that changes. */
async function widgetCenter(widget: Locator): Promise<Point> {
	const box = await widget.boundingBox();
	if (!box) throw new Error('footnote reference has no bounding box');
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('footnote jump: reference to definition', () => {
	let editor: FootnotePage;
	let defA: number;
	let defB: number;

	test.beforeEach(async ({ page }) => {
		editor = new FootnotePage(page);
		const doc = navDoc();
		defA = doc.defA;
		defB = doc.defB;
		await editor.load(doc.md);
		// Precondition every test below reads as its negative: the definitions are windowed out.
		await expect(page.locator(`[data-block-path='[${defA}]']`)).toHaveCount(0);
	});

	test('reading mode: a plain click mounts the definition and brings it into view', async ({
		page
	}) => {
		await editor.setPresentationMode('reading');

		await editor.refs().nth(0).click();
		await editor.waitForRenderFlush();

		await expect.poll(() => blockView(page, [defA])).toEqual({ mounted: true, inView: true });
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('live mode: Ctrl+click lands the caret in the definition body, so the next key edits it', async ({
		page
	}) => {
		await editor.setPresentationMode('live');

		await editor
			.refs()
			.nth(0)
			.click({ modifiers: ['Control'] });

		// The container holds no caret of its own, so the landing is its body block.
		await expect.poll(() => activeBlockPath(page)).toEqual([defA, 0]);
		await expect.poll(() => blockView(page, [defA])).toEqual({ mounted: true, inView: true });

		await page.keyboard.type('X');
		expect(await editor.bridge.getSource()).toContain('[^a]: XFirst note.');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('the second reference jumps to its own definition, not the first one', async ({ page }) => {
		await editor.setPresentationMode('source');

		await editor
			.refs()
			.nth(1)
			.click({ modifiers: ['Control'] });

		await expect.poll(() => activeBlockPath(page)).toEqual([defB, 0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a plain click in an editing mode still reveals the source, and navigates nowhere', async ({
		page
	}) => {
		await editor.setPresentationMode('source');

		await editor.refs().nth(0).click();
		await editor.waitForRenderFlush();

		// The 'a' widget folded out to its editable `[^a]` bytes; the other two stand.
		await expect(editor.refs()).toHaveCount(2);
		expect(await editor.getBlockText(0)).toContain('[^a]');
		await expect(page.locator(`[data-block-path='[${defA}]']`)).toHaveCount(0);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a reference with no definition ignores the gesture — no jump, and no reveal either', async ({
		page
	}) => {
		await editor.setPresentationMode('source');

		await editor
			.refs()
			.nth(2)
			.click({ modifiers: ['Control'] });
		await editor.waitForRenderFlush();

		// The claim stands the reveal down whether or not the label resolves, so all three
		// widgets are still rendered and nothing moved.
		await expect(editor.refs()).toHaveCount(3);
		expect(await editor.bridge.getSource()).toContain(REFS);
		await expect(page.locator(`[data-block-path='[${defA}]']`)).toHaveCount(0);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

// Short document: nothing windows out, so the reference's own block stays mounted and its
// widget count is a live oracle for whether the surface revealed the source under the click.
test.describe('footnote jump: gesture ownership (navigate, not reveal)', () => {
	let editor: FootnotePage;

	test.beforeEach(async ({ page }) => {
		editor = new FootnotePage(page);
		await editor.load(SHORT_DOC);
		await editor.setPresentationMode('source');
	});

	test('Ctrl+click navigates without swapping the reference for its source bytes', async ({
		page
	}) => {
		await editor
			.refs()
			.nth(0)
			.click({ modifiers: ['Control'] });

		await expect.poll(() => activeBlockPath(page)).toEqual([1, 0]);
		await expect(editor.refs()).toHaveCount(2);
		expect(await editor.getBlockText(0)).not.toContain('[^a]');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Ctrl pressed after the press, before the release: the click navigates', async ({
		page
	}) => {
		const { x, y } = await widgetCenter(editor.refs().nth(0));

		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.keyboard.down('Control');
		await page.mouse.up();
		await page.keyboard.up('Control');
		await editor.waitForRenderFlush();

		await expect.poll(() => activeBlockPath(page)).toEqual([1, 0]);
		await expect(editor.refs()).toHaveCount(2);
		expect(await editor.getBlockText(0)).not.toContain('[^a]');
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('Ctrl released before the release: the click reveals, and navigates nowhere', async ({
		page
	}) => {
		const { x, y } = await widgetCenter(editor.refs().nth(0));

		await page.keyboard.down('Control');
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.keyboard.up('Control');
		await page.mouse.up();
		await editor.waitForRenderFlush();

		// The plain-click semantics the unmodified click has: `[^a]` folds out, `[^b]` stands.
		await expect(editor.refs()).toHaveCount(1);
		expect(await editor.getBlockText(0)).toContain('[^a]');
		// The caret stayed with the reveal; a jump would have taken it to the definition body.
		await expect.poll(() => activeBlockPath(page)).toEqual([0]);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

test.describe('footnote jump: definition back to reference', () => {
	let editor: FootnotePage;

	test.beforeEach(async ({ page }) => {
		editor = new FootnotePage(page);
	});

	test('the back-link mounts the referencing block and lands the caret there', async ({ page }) => {
		const { md, defA } = navDoc();
		await editor.load(md);
		await editor.setPresentationMode('source');
		await editor
			.refs()
			.nth(0)
			.click({ modifiers: ['Control'] });
		await expect.poll(() => activeBlockPath(page)).toEqual([defA, 0]);
		// The reference's own block windowed out on the way down, so the return trip mounts it.
		await expect(page.locator("[data-block-path='[0]']")).toHaveCount(0);

		await editor.backref(defA).click();

		await expect.poll(() => blockView(page, [0])).toEqual({ mounted: true, inView: true });
		await expect.poll(() => activeBlockPath(page)).toEqual([0]);
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('reading mode: the back-link takes the same plain click', async ({ page }) => {
		const { md, defA } = navDoc();
		await editor.load(md);
		await editor.setPresentationMode('reading');
		await editor.refs().nth(0).click();
		await expect.poll(() => blockView(page, [defA])).toEqual({ mounted: true, inView: true });
		await expect(page.locator("[data-block-path='[0]']")).toHaveCount(0);

		await editor.backref(defA).click();

		// Reading mode seats no caret, so arrival is the whole assertion.
		await expect.poll(() => blockView(page, [0])).toEqual({ mounted: true, inView: true });
		expect(await capturedErrors(page)).toEqual([]);
	});

	test('a definition no reference points at carries no back-link', async ({ page }) => {
		await editor.load(
			'Body has [^a] here.\n\n[^a]: First note.\n\n[^orphan]: Nobody points here.\n'
		);
		await editor.setPresentationMode('source');

		await expect(editor.backref(1)).toHaveCount(1);
		await expect(editor.backref(2)).toHaveCount(0);
		expect(await capturedErrors(page)).toEqual([]);
	});
});

// The cell's own `navigateTo` wiring: a reference inside a table cell rides a different
// surface than prose, so a dropped forward there is invisible to every test above.
test.describe('footnote jump: from a table cell', () => {
	test('Ctrl+click on a reference in a cell lands the caret in the definition', async ({
		page
	}) => {
		const editor = new FootnotePage(page);
		await editor.load('| Note |\n| --- |\n| See [^a] |\n\n[^a]: First note.\n');
		await editor.setPresentationMode('source');

		await editor
			.refs()
			.nth(0)
			.click({ modifiers: ['Control'] });

		await expect.poll(() => activeBlockPath(page)).toEqual([1, 0]);
		await expect(editor.refs()).toHaveCount(1);
		expect(await capturedErrors(page)).toEqual([]);
	});
});
