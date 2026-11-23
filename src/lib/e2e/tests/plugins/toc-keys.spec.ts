import { test, expect } from '../../fixtures';
import { PluginsPage } from './helpers';

/**
 * The keys and clicks around a `[[toc]]` block, first or last in a three-block document
 * (requirements/plugins/toc-keys.md). A caret reads `path:offset`; a gap caret reads `gap:index`.
 */

const FIRST = '[[toc]]\n\n# Alpha\n\nbody text\n';
const LAST = '# Alpha\n\nbody text\n\n[[toc]]\n';

class TocKeysPage extends PluginsPage {
	async load(md: string): Promise<void> {
		await this.gotoPlugins('toc');
		await this.loadContent(md);
		await expect(this.page.locator('.toc-block-render')).toBeVisible();
	}

	async caret(): Promise<string | null> {
		const gap = await this.bridge.getGapCaret();
		if (gap) return `gap:${gap.index}`;
		const sel = await this.bridge.getSelection();
		return sel ? `${sel.focus.path.join('.')}:${sel.focus.offset}` : null;
	}

	async press(...keys: string[]): Promise<void> {
		for (const key of keys) await this.page.keyboard.press(key);
		await this.waitForRenderFlush();
	}

	/** A click `dy` pixels past the outline's top (negative) or bottom (positive) edge. */
	async clickBeside(index: number, dy: number): Promise<void> {
		const box = (await this.page.locator(`[data-block-path="[${index}]"]`).boundingBox())!;
		await this.page.mouse.click(box.x + 40, dy < 0 ? box.y + dy : box.y + box.height + dy);
		await this.waitForRenderFlush();
	}

	get source() {
		return this.page.locator('.toc-block-source');
	}
}

test.describe('the outline first', () => {
	let editor: TocKeysPage;
	test.beforeEach(async ({ page }) => {
		editor = new TocKeysPage(page);
		await editor.load(FIRST);
		await editor.focusBlockAtPath([1], 0);
	});

	test('ArrowUp from the heading below enters the source at its start', async () => {
		await editor.press('ArrowUp');
		await expect.poll(() => editor.caret()).toBe('0:0');
		await expect(editor.source).toHaveText('[[toc]]');
	});

	test('ArrowUp again puts a gap caret above it', async () => {
		await editor.press('ArrowUp', 'ArrowUp');
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 0 });
	});

	test('a letter at that gap caret becomes a paragraph above', async () => {
		await editor.press('ArrowUp', 'ArrowUp');
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 0 });
		await editor.typeSlowly('x');
		await editor.bridge.waitForSourceEquals(`x\n\n${FIRST}`);
		await expect.poll(() => editor.caret()).toBe('0:1');
	});

	test('Enter at that gap caret puts an empty paragraph above, the caret in it', async () => {
		await editor.press('ArrowUp', 'ArrowUp');
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 0 });
		await editor.press('Enter');
		await editor.bridge.waitForSourceEquals(`\n${FIRST}`);
		expect(await editor.bridge.getBlockKind(0)).toBe('paragraph');
		await expect.poll(() => editor.caret()).toBe('0:0');
	});

	test('Backspace at that gap caret changes nothing', async () => {
		await editor.press('ArrowUp', 'ArrowUp');
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 0 });
		await editor.press('Backspace');
		expect(await editor.bridge.getSource()).toBe(FIRST);
		expect(await editor.caret()).toBe('gap:0');
	});

	test('ArrowDown from that gap caret goes back to the source’s start', async () => {
		await editor.press('ArrowUp', 'ArrowUp');
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 0 });
		await editor.press('ArrowDown');
		await expect.poll(() => editor.caret()).toBe('0:0');
	});

	test('a click just above it puts a gap caret above it', async () => {
		await editor.clickBeside(0, -6);
		await editor.bridge.waitForGapCaret({ parentPath: [], index: 0 });
	});
});

test.describe('the outline last', () => {
	let editor: TocKeysPage;
	test.beforeEach(async ({ page }) => {
		editor = new TocKeysPage(page);
		await editor.load(LAST);
	});

	test('ArrowDown from the paragraph above enters the source at its end', async () => {
		await editor.focusBlockAtPath([1], 9);
		await editor.press('ArrowDown');
		await expect.poll(() => editor.caret()).toBe('2:7');
	});

	test('ArrowDown again opens an empty paragraph below', async () => {
		await editor.focusBlockAtPath([1], 9);
		await editor.press('ArrowDown', 'ArrowDown');
		await editor.bridge.waitForSourceEquals(`${LAST}\n\n`);
		await expect.poll(() => editor.caret()).toBe('3:0');
	});

	test('a click just below it opens an empty paragraph below', async () => {
		await editor.clickBeside(2, 6);
		await editor.bridge.waitForSourceEquals(`${LAST}\n\n`);
		await expect.poll(() => editor.caret()).toBe('3:0');
	});

	test('ArrowUp from its source goes back to the paragraph above', async () => {
		await editor.focusBlockAtPath([1], 9);
		await editor.press('ArrowDown');
		await expect.poll(() => editor.caret()).toBe('2:7');
		await editor.press('ArrowUp');
		await expect.poll(() => editor.caret()).toBe('1:9');
	});
});

test.describe('the open source', () => {
	let editor: TocKeysPage;
	test.beforeEach(async ({ page }) => {
		editor = new TocKeysPage(page);
		await editor.load(LAST);
		await editor.focusBlockAtPath([1], 9);
		await editor.press('ArrowDown');
		await expect.poll(() => editor.caret()).toBe('2:7');
	});

	test('Backspace at its end deletes the last character, the bytes waiting for the caret to leave', async () => {
		await editor.press('Backspace');
		await expect(editor.source).toHaveText('[[toc]');
		expect(await editor.bridge.getSource()).toBe(LAST);
		await expect.poll(() => editor.caret()).toBe('2:6');
	});

	test('Enter at its end types a line break into it', async () => {
		await editor.press('Enter');
		await expect.poll(() => editor.source.evaluate((el) => el.textContent)).toBe('[[toc]]\n');
		expect(await editor.bridge.getSource()).toBe(LAST);
		await expect.poll(() => editor.caret()).toBe('2:8');
	});
});
