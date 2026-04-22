import { type Page, type Locator } from '@playwright/test';

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
		// serialize() normalizes trailing whitespace; compare on trimmed forms.
		await this.page.waitForFunction(
			(expected) => {
				const actual = (window as any).__test.getSource() as string;
				return actual.replace(/\s+$/, '') === expected.replace(/\s+$/, '');
			},
			md,
			{ timeout: 2000, polling: 16 }
		);
		await this.editorContainer.waitFor({ state: 'visible' });
	}

	// ── Cross-Block Selection Queries ───────────────────────────────────

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

	getBlock(index: number): Locator {
		return this.page
			.locator('.block-list > .block-host')
			.nth(index)
			.locator(':scope > *:not(.selection-overlay)')
			.first();
	}

	getBlocks(): Locator {
		return this.page.locator('.block-list > .block-host > *:not(.selection-overlay)');
	}

	async getBlockText(index: number): Promise<string> {
		return (await this.getBlock(index).textContent()) ?? '';
	}

	async getDomBlockCount(): Promise<number> {
		return this.getBlocks().count();
	}

	// ── Cursor Positioning ──────────────────────────────────────────────

	async focusBlockEnd(index: number) {
		await this.placeCaretInBlock(index, 'end');
	}

	async focusBlock(index: number, offset: number) {
		await this.placeCaretInBlock(index, offset);
	}

	async focusBlockStart(index: number) {
		await this.placeCaretInBlock(index, 'start');
	}

	private async placeCaretInBlock(
		index: number,
		position: 'start' | 'end' | number
	): Promise<void> {
		await this.page.evaluate(
			({ idx, position }) => {
				const blocks = document.querySelectorAll(
					'.block-list > .block-host > :not(.selection-overlay)'
				);
				const block = blocks[idx] as HTMLElement | undefined;
				if (!block) return;
				block.focus();

				const range = document.createRange();
				if (position === 'start' || position === 'end') {
					range.selectNodeContents(block);
					range.collapse(position === 'start');
				} else {
					let remaining = position;
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
					if (pos) {
						range.setStart(pos.node, pos.offset);
						range.collapse(true);
					} else {
						range.selectNodeContents(block);
						range.collapse(false);
					}
				}
				const sel = window.getSelection()!;
				sel.removeAllRanges();
				sel.addRange(range);
			},
			{ idx: index, position }
		);
	}

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
				const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
					// Ambient marker spans (contenteditable="false") contribute to DOM
					// textContent but not to raw. Callers pass raw-semantic offsets.
					acceptNode(n) {
						const parent = (n as Text).parentElement;
						if (parent?.closest('.md-marker[contenteditable="false"]')) {
							return NodeFilter.FILTER_REJECT;
						}
						return NodeFilter.FILTER_ACCEPT;
					}
				});
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

	async typeText(text: string) {
		await this.page.keyboard.insertText(text);
	}

	/**
	 * Type text character-by-character via keyboard.type(). Each character fires its
	 * own keydown/input/keyup cycle. Use for tests where per-keystroke behavior
	 * matters (formatting, kind changes).
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

	// macOS binds undo/redo/select-all to Cmd; every other platform uses Ctrl.
	async undo() {
		await this.page.keyboard.press(`${this.primaryModifier}+z`);
	}

	async redo() {
		await this.page.keyboard.press(`${this.primaryModifier}+Shift+z`);
	}

	async selectAll() {
		await this.page.keyboard.press(`${this.primaryModifier}+a`);
	}

	private get primaryModifier(): 'Meta' | 'Control' {
		return process.platform === 'darwin' ? 'Meta' : 'Control';
	}

	async screenshot(name: string) {
		await this.page.screenshot({ path: `test-results/${name}.png` });
	}

	// ── Drag & Shift+Click Helpers ─────────────────────────────────────

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
				const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, {
					// Ambient marker spans (contenteditable="false") contribute to DOM
					// textContent but not to raw. Callers pass raw-semantic offsets.
					acceptNode(n) {
						const parent = (n as Text).parentElement;
						if (parent?.closest('.md-marker[contenteditable="false"]')) {
							return NodeFilter.FILTER_REJECT;
						}
						return NodeFilter.FILTER_ACCEPT;
					}
				});
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
				const rect = editable.getBoundingClientRect();
				return { x: rect.right - 1, y: rect.top + rect.height / 2 };
			},
			{ path, offset }
		);
	}

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
