import { test, expect } from '../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../editor-page';

// Decoded-entity atomic widget (requirements/entity-widget.md). `&copy;` renders
// as a `[data-inline-widget]` showing ©; the raw bytes ride data-source-*. The
// atomic-delete case is the first executable pin of deleteGranularity:'atomic'.

// Caret offset in raw-content coordinates, widget-aware: text-node lengths plus
// each widget's data-source span (its glyph contributes 0). Mirrors the raw walk.
async function caretRaw(page: Page): Promise<number | null> {
	return page.evaluate(() => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0) return null;
		const r = sel.getRangeAt(0);
		const ce = document.querySelector('[contenteditable="true"]') as HTMLElement | null;
		if (!ce || !ce.contains(r.startContainer)) return null;
		let count = 0;
		let stopped = false;
		function visit(current: Node): void {
			if (stopped) return;
			if (current === r.startContainer) {
				if (current.nodeType === Node.TEXT_NODE) count += r.startOffset;
				else {
					const cap = Math.min(r.startOffset, current.childNodes.length);
					for (let i = 0; i < cap; i++) visit(current.childNodes[i]);
				}
				stopped = true;
				return;
			}
			if (current.nodeType === Node.TEXT_NODE) {
				count += current.textContent?.length ?? 0;
				return;
			}
			if (current.nodeType === Node.ELEMENT_NODE) {
				const el = current as Element;
				if (el.matches?.('[data-inline-widget]')) {
					const s = parseInt(el.getAttribute('data-source-start') ?? '', 10);
					const e = parseInt(el.getAttribute('data-source-end') ?? '', 10);
					if (!isNaN(s) && !isNaN(e)) count += e - s;
					return;
				}
				if (el.matches?.('.md-marker')) return;
				for (const child of current.childNodes) visit(child);
			}
		}
		visit(ce);
		return count;
	});
}

const glyph = (page: Page) => page.locator('[data-inline-widget]');

test.describe('decoded-entity atomic widget', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('typing &copy; renders the © glyph; the source stays the literal reference', async () => {
		await editor.loadContent('ab\n');
		await editor.focusBlockAtPath([0], 1);
		await editor.typeSlowly('&copy;');
		await expect(glyph(editor.page)).toHaveText('©');
		expect(await editor.bridge.getSource()).toContain('a&copy;b');
	});

	test('a plain arrow steps the caret across the glyph in one press, both directions', async ({
		page
	}) => {
		await editor.loadContent('a&copy;b\n');
		await expect(glyph(page)).toHaveText('©');
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight'); // into 'a' → leading edge of the entity
		expect(await caretRaw(page)).toBe(1);
		await page.keyboard.press('ArrowRight'); // steps over the whole glyph
		expect(await caretRaw(page)).toBe(7);
		await page.keyboard.press('ArrowLeft'); // steps back over it
		expect(await caretRaw(page)).toBe(1);
	});

	test('adjacent entities with no cushioning text step over one glyph per press', async ({
		page
	}) => {
		await editor.loadContent('&copy;&reg;\n');
		await expect(glyph(page)).toHaveCount(2);
		await editor.focusBlockStart(0);
		await page.keyboard.press('ArrowRight'); // over &copy;
		expect(await caretRaw(page)).toBe(6);
		await page.keyboard.press('ArrowRight'); // over &reg;
		expect(await caretRaw(page)).toBe(11);
		await page.keyboard.press('ArrowLeft'); // back over &reg;
		expect(await caretRaw(page)).toBe(6);
	});

	test('one Backspace deletes the whole entity; one undo restores it', async ({ page }) => {
		await editor.loadContent('a&copy;b\n');
		await expect(glyph(page)).toHaveText('©');
		await editor.focusBlockEnd(0);
		await page.keyboard.press('ArrowLeft'); // to the entity's trailing edge (before 'b')
		expect(await caretRaw(page)).toBe(7);
		await page.keyboard.press('Backspace');
		await editor.bridge.waitForSourceEquals('ab\n');
		await editor.undo();
		await editor.bridge.waitForSourceEquals('a&copy;b\n');
	});

	test('copying across the entity yields the raw bytes, never the glyph', async ({ page }) => {
		await editor.loadContent('a&copy;b\n');
		await expect(glyph(page)).toHaveText('©');
		await editor.focusBlock(0, 0);
		await editor.selectAll();
		await page.keyboard.press('Control+c');
		await editor.waitForClipboardWrite();
		const clip = await editor.readClipboard();
		expect(clip).toContain('&copy;');
		expect(clip).not.toContain('©');
	});

	test('reading mode still renders the glyph', async ({ page }) => {
		await editor.loadContent('a&copy;b\n');
		await page.getByTestId('presentation-toggle').click();
		await expect(editor.editorContainer).toHaveAttribute('data-presentation', 'reading');
		await expect(glyph(page)).toHaveText('©');
	});

	test('an entity inside a table cell renders the glyph', async ({ page }) => {
		await editor.loadContent('| a&copy;b | c |\n| --- | --- |\n');
		await expect(glyph(page)).toHaveText('©');
	});

	test('&nbsp; keeps its literal source span, not a widget', async ({ page }) => {
		await editor.loadContent('a&nbsp;b\n');
		await expect(glyph(page)).toHaveCount(0);
		expect(await editor.getBlockText(0)).toContain('&nbsp;');
	});
});
