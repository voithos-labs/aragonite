import { type Page, type Locator } from '@playwright/test';

/**
 * Page object for the Limestone editor test harness.
 * Wraps Playwright Page with editor-specific helpers.
 */
export class EditorPage {
	readonly editorContainer: Locator;

	constructor(public page: Page) {
		this.editorContainer = page.locator('.editor');
	}

	// ── Navigation ──────────────────────────────────────────────────────

	async goto() {
		await this.page.goto('/test/editor');
		await this.editorContainer.waitFor({ state: 'visible' });
		await this.page.waitForFunction(() => (window as any).__test !== undefined, null, {
			timeout: 10_000
		});
	}

	async loadContent(md: string) {
		await this.page.evaluate((content) => {
			(window as any).__test.setSource(content);
		}, md);
		// Wait for Svelte reactivity to settle
		await this.page.waitForTimeout(200);
		await this.editorContainer.waitFor({ state: 'visible' });
	}

	// ── Cross-Block Selection Queries ───────────────────────────────────

	/** Wait for cross-block mode to become active or inactive. */
	async waitForCrossBlock(active: boolean): Promise<void> {
		if (active) {
			await this.page.waitForSelector('[data-cross-block]', { state: 'attached', timeout: 2000 });
		} else {
			await this.page.waitForSelector('[data-cross-block]', { state: 'detached', timeout: 2000 });
		}
	}

	async isCrossBlockActive(): Promise<boolean> {
		return this.page.evaluate(() => {
			if ((window as any).__test?.isCrossBlockActive) {
				return (window as any).__test.isCrossBlockActive();
			}
			return document.querySelector('[data-cross-block]') !== null;
		});
	}

	async getSelectionPaths(): Promise<{
		anchor: { path: number[]; offset: number };
		focus: { path: number[]; offset: number };
	} | null> {
		return this.page.evaluate(() => {
			if ((window as any).__test?.getSelectionPaths) {
				return (window as any).__test.getSelectionPaths();
			}
			return null;
		});
	}

	// ── State Queries (via test bridge) ─────────────────────────────────

	async getSource(): Promise<string> {
		return this.page.evaluate(() => (window as any).__test.getSource());
	}

	async getBlockCount(): Promise<number> {
		return this.page.evaluate(() => (window as any).__test.getBlockCount());
	}

	async getBlockKind(index: number): Promise<string> {
		return this.page.evaluate((i) => (window as any).__test.getBlockKind(i), index);
	}

	// ── DOM Queries ─────────────────────────────────────────────────────

	/** Get the nth top-level block element in the editor. */
	getBlock(index: number): Locator {
		return this.page
			.locator('.block-list > .block-host')
			.nth(index)
			.locator(':scope > *:not(.selection-overlay)')
			.first();
	}

	/** Get all top-level block elements. */
	getBlocks(): Locator {
		return this.page.locator('.block-list > .block-host > *:not(.selection-overlay)');
	}

	/** Get the text content of the nth block from the DOM. */
	async getBlockText(index: number): Promise<string> {
		return (await this.getBlock(index).textContent()) ?? '';
	}

	/** Count blocks via DOM (reflects editor internal state, including empty blocks). */
	async getDomBlockCount(): Promise<number> {
		return this.getBlocks().count();
	}

	// ── Cursor Positioning ──────────────────────────────────────────────

	/** Focus a block and place the cursor at the end of its content. */
	async focusBlockEnd(index: number) {
		await this.page.evaluate((idx) => {
			const blocks = document.querySelectorAll(
				'.block-list > .block-host > :not(.selection-overlay)'
			);
			const block = blocks[idx] as HTMLElement;
			if (!block) return;
			block.focus();
			const range = document.createRange();
			range.selectNodeContents(block);
			range.collapse(false);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);
		}, index);
	}

	/** Focus a block and place the cursor at a specific offset within its content. */
	async focusBlock(index: number, offset: number) {
		await this.page.evaluate(
			({ idx, off }) => {
				const blocks = document.querySelectorAll(
					'.block-list > .block-host > :not(.selection-overlay)'
				);
				const block = blocks[idx] as HTMLElement;
				if (!block) return;
				block.focus();

				// Walk text nodes to find the position at `off`
				let remaining = off;
				function walk(node: Node): { node: Node; offset: number } | null {
					if (node.nodeType === Node.TEXT_NODE) {
						const len = node.textContent?.length ?? 0;
						if (remaining <= len) return { node, offset: remaining };
						remaining -= len;
						return null;
					}
					for (const child of node.childNodes) {
						const result = walk(child);
						if (result) return result;
					}
					return null;
				}

				const pos = walk(block);
				const range = document.createRange();
				if (pos) {
					range.setStart(pos.node, pos.offset);
					range.collapse(true);
				} else {
					range.selectNodeContents(block);
					range.collapse(false);
				}
				const sel = window.getSelection()!;
				sel.removeAllRanges();
				sel.addRange(range);
			},
			{ idx: index, off: offset }
		);
	}

	/** Focus a block and place the cursor at the start of its content. */
	async focusBlockStart(index: number) {
		await this.page.evaluate((idx) => {
			const blocks = document.querySelectorAll(
				'.block-list > .block-host > :not(.selection-overlay)'
			);
			const block = blocks[idx] as HTMLElement;
			if (!block) return;
			block.focus();
			const range = document.createRange();
			range.selectNodeContents(block);
			range.collapse(true);
			const sel = window.getSelection()!;
			sel.removeAllRanges();
			sel.addRange(range);
		}, index);
	}

	/** Focus a block by its CST path and place the cursor at a character offset. */
	async focusBlockAtPath(path: number[], offset: number): Promise<void> {
		await this.page.evaluate(
			({ path, offset }) => {
				const attr = JSON.stringify(path);
				const wrapper = document.querySelector(`[data-block-path='${attr}']`);
				if (!wrapper) return;
				const block = wrapper.querySelector(
					':scope > :not(.selection-overlay)'
				) as HTMLElement | null;
				if (!block) return;
				block.focus();

				const range = document.createRange();
				const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
				let remaining = offset;
				let node: Node | null;
				while ((node = walker.nextNode())) {
					const len = node.textContent?.length ?? 0;
					if (remaining <= len) {
						range.setStart(node, remaining);
						range.setEnd(node, remaining);
						const sel = window.getSelection();
						sel?.removeAllRanges();
						sel?.addRange(range);
						return;
					}
					remaining -= len;
				}
				const sel = window.getSelection();
				sel?.removeAllRanges();
				range.selectNodeContents(block);
				range.collapse(false);
				sel?.addRange(range);
			},
			{ path, offset }
		);
	}

	// ── User Actions ────────────────────────────────────────────────────

	async clickBlock(index: number) {
		await this.getBlock(index).click();
	}

	/**
	 * Insert text at the current cursor position.
	 * Uses insertText to avoid per-character re-render issues.
	 */
	async typeText(text: string) {
		await this.page.keyboard.insertText(text);
	}

	/**
	 * Type text character-by-character via keyboard.type().
	 * Each character fires its own keydown/input/keyup cycle.
	 * Use for tests where per-keystroke behavior matters (formatting, kind changes).
	 * Only works after the single-render-path fix (otherwise causes reversed text).
	 */
	async typeSlowly(text: string) {
		await this.page.keyboard.type(text);
	}

	async typeInBlock(index: number, text: string) {
		await this.clickBlock(index);
		await this.page.keyboard.insertText(text);
	}

	async pressKey(key: string) {
		await this.page.keyboard.press(key);
	}

	async pressEnter() {
		await this.pressKey('Enter');
	}

	async pressBackspace() {
		await this.pressKey('Backspace');
	}

	async pressArrowUp() {
		await this.pressKey('ArrowUp');
	}

	async pressArrowDown() {
		await this.pressKey('ArrowDown');
	}

	async undo() {
		await this.page.keyboard.press('Control+z');
	}

	async redo() {
		await this.page.keyboard.press('Control+Shift+z');
	}

	async selectAll() {
		await this.page.keyboard.press('Control+a');
	}

	async screenshot(name: string) {
		await this.page.screenshot({ path: `test-results/${name}.png` });
	}

	// ── Drag & Shift+Click Helpers ─────────────────────────────────────

	/**
	 * Simulate a pointer drag from one block offset to another. Uses
	 * mouse.down / mouse.move / mouse.up for a realistic drag sequence.
	 */
	async dragFromTo(
		startPath: number[],
		startOffset: number,
		endPath: number[],
		endOffset: number
	): Promise<void> {
		const start = await this.pointForOffset(startPath, startOffset);
		const end = await this.pointForOffset(endPath, endOffset);
		if (!start || !end) throw new Error('dragFromTo: could not resolve block offsets');

		await this.page.mouse.move(start.x, start.y);
		await this.page.mouse.down();
		const steps = 10;
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			await this.page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
		}
		await this.page.mouse.up();
		await this.page.waitForTimeout(100);
	}

	async shiftClickBlock(path: number[], offset: number): Promise<void> {
		const point = await this.pointForOffset(path, offset);
		if (!point) throw new Error('shiftClickBlock: could not resolve point');
		await this.page.keyboard.down('Shift');
		await this.page.mouse.click(point.x, point.y);
		await this.page.keyboard.up('Shift');
		await this.page.waitForTimeout(100);
	}

	/**
	 * Resolve a block path + character offset to viewport coordinates via
	 * Range measurement inside the browser. Returns null if the block or
	 * offset can't be found.
	 */
	private async pointForOffset(
		path: number[],
		offset: number
	): Promise<{ x: number; y: number } | null> {
		return this.page.evaluate(
			({ path, offset }) => {
				const wrapper = document.querySelector(`[data-block-path='${JSON.stringify(path)}']`);
				const editable = wrapper?.querySelector('[contenteditable]') as HTMLElement | null;
				if (!editable) return null;
				const range = document.createRange();
				let remaining = offset;
				const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
				let node: Node | null;
				while ((node = walker.nextNode())) {
					const len = node.textContent?.length ?? 0;
					if (remaining <= len) {
						range.setStart(node, remaining);
						range.setEnd(node, remaining);
						const rect = range.getBoundingClientRect();
						return { x: rect.left + 1, y: rect.top + rect.height / 2 };
					}
					remaining -= len;
				}
				// Offset beyond content — place at end.
				const rect = editable.getBoundingClientRect();
				return { x: rect.right - 1, y: rect.top + rect.height / 2 };
			},
			{ path, offset }
		);
	}

	/**
	 * Returns the viewport-absolute pixel X of the current selection's caret.
	 * Returns NaN if no range is present. Used for sticky column proximity
	 * assertions in E2E tests — tests accept the cursor landing at a nearby
	 * offset (tolerance ~5 px) rather than a pixel-exact match, because
	 * proportional fonts mean the target offset's pixel X may not exactly
	 * equal the source X.
	 */
	async getCaretPixelX(): Promise<number> {
		return this.page.evaluate(() => {
			const sel = window.getSelection();
			if (!sel || sel.rangeCount === 0) return NaN;
			const range = sel.getRangeAt(0);
			const rects = range.getClientRects();
			if (rects.length > 0) return rects[0].left;
			return range.getBoundingClientRect().left;
		});
	}
}
