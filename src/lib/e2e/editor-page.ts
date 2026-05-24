import { type Page, type Locator } from '@playwright/test';
import { primaryModifier } from './platform';
import { EditorBridge } from './editor-bridge';

export class EditorPage {
	readonly editorContainer: Locator;
	readonly bridge: EditorBridge;

	constructor(public page: Page) {
		this.editorContainer = page.locator('.editor');
		this.bridge = new EditorBridge(page);
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

	// ── DOM Queries ─────────────────────────────────────────────────────

	// Top-level addressing only. Container blocks (blockquote, list, listItem)
	// render nested BlockHosts whose data-block-path carries a comma; the
	// :not([data-block-path*=","]) filter excludes them. Use focusBlockAtPath
	// for nested addressing.
	getBlock(index: number): Locator {
		return this.page
			.locator(`[data-block-path='${JSON.stringify([index])}']`)
			.locator(':scope > *:not(.selection-overlay)')
			.first();
	}

	getBlocks(): Locator {
		return this.page
			.locator('[data-block-path]:not([data-block-path*=","])')
			.locator(':scope > *:not(.selection-overlay)');
	}

	async getDomBlockCount(): Promise<number> {
		return this.getBlocks().count();
	}

	async getBlockText(index: number): Promise<string> {
		return (await this.getBlock(index).textContent()) ?? '';
	}

	async waitForCrossBlock(active: boolean): Promise<void> {
		if (active) {
			await this.page.waitForSelector('[data-cross-block]', { state: 'attached', timeout: 2000 });
		} else {
			await this.page.waitForSelector('[data-cross-block]', { state: 'detached', timeout: 2000 });
		}
	}

	/**
	 * Wait until the live list-item DOM count matches `expected`. Enter at end
	 * of a list item inserts an empty trailing item whose marker is trimmed in
	 * the serialized source — bridge predicates that consult `getSource()` see
	 * no change. DOM count is the cheapest observable signal that the post-Enter
	 * tree has flushed before the next keystroke.
	 */
	async waitForListItemCount(expected: number, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(n) => document.querySelectorAll('.list-item-block').length === n,
			expected,
			{ timeout, polling: 16 }
		);
	}

	/**
	 * Wait until the total `.block-host` count (top-level + nested) matches
	 * `expected`. Enter at end of a paragraph or inside a blockquote inserts a
	 * transient empty paragraph whose marker is trimmed in the serialized
	 * source — `getBlockCount()` re-parses the source and can't see it. Every
	 * block (top-level and nested) wraps in `.block-host`, so the total count
	 * changes by one per insertion and is the cheapest observable signal that
	 * the post-Enter tree has flushed.
	 */
	async waitForBlockHostCount(expected: number, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(n) => document.querySelectorAll('.block-host').length === n,
			expected,
			{ timeout, polling: 16 }
		);
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
			({ pathAttr, position }) => {
				const wrapper = document.querySelector(`[data-block-path='${pathAttr}']`);
				const block = wrapper?.querySelector(
					':scope > :not(.selection-overlay)'
				) as HTMLElement | null;
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
			{ pathAttr: JSON.stringify([index]), position }
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

	// macOS binds undo/redo/select-all to Cmd; every other platform uses Ctrl.
	async undo() {
		await this.page.keyboard.press(`${primaryModifier}+z`);
	}

	async redo() {
		await this.page.keyboard.press(`${primaryModifier}+Shift+z`);
	}

	async selectAll() {
		await this.page.keyboard.press(`${primaryModifier}+a`);
	}

	async screenshot(name: string) {
		await this.page.screenshot({ path: `test-results/${name}.png` });
	}

	// ── Clipboard ──────────────────────────────────────────────────────

	/**
	 * Yield until the synthetic clipboard write triggered by Ctrl+C lands on
	 * the system clipboard. The editor's copy handler writes via a synthetic
	 * `copy` event whose flush timing the browser owns; no editor state
	 * changes, so no bridge predicate can observe it. Call before
	 * `navigator.clipboard.readText()` or before a subsequent Ctrl+V that
	 * must see the fresh payload. This is the copy-only carve-out documented
	 * in docs/testing.md § Key Patterns and Gotchas.
	 */
	async waitForClipboardWrite(): Promise<void> {
		await this.page.waitForTimeout(150);
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
		await this.dragMouseTo(start, end);
		await this.page.mouse.up();
		await this.waitForPointerSettle();
	}

	/**
	 * Single pointer-down → drag through `mid` → drag to `end` → pointer-up.
	 * The intermediate point keeps the button held the whole time; a sequence
	 * of two dragFromTo calls would release and re-press between segments.
	 */
	async dragFromToThenTo(
		startPath: number[],
		startOffset: number,
		midPath: number[],
		midOffset: number,
		endPath: number[],
		endOffset: number
	): Promise<void> {
		const start = await this.pointForOffset(startPath, startOffset);
		const mid = await this.pointForOffset(midPath, midOffset);
		const end = await this.pointForOffset(endPath, endOffset);
		if (!start || !mid || !end) throw new Error('dragFromToThenTo: could not resolve offsets');

		await this.page.mouse.move(start.x, start.y);
		await this.page.mouse.down();
		await this.dragMouseTo(start, mid);
		await this.dragMouseTo(mid, end);
		await this.page.mouse.up();
		await this.waitForPointerSettle();
	}

	private async dragMouseTo(
		from: { x: number; y: number },
		to: { x: number; y: number }
	): Promise<void> {
		const steps = 10;
		for (let i = 1; i <= steps; i++) {
			const t = i / steps;
			await this.page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t);
		}
	}

	async shiftClickBlock(path: number[], offset: number): Promise<void> {
		const point = await this.pointForOffset(path, offset);
		if (!point) throw new Error('shiftClickBlock: could not resolve point');
		await this.page.keyboard.down('Shift');
		await this.page.mouse.click(point.x, point.y);
		await this.page.keyboard.up('Shift');
		await this.waitForPointerSettle();
	}

	/**
	 * Yield until post-pointer reactivity has flushed. After mouse.up (drag) or
	 * shift-click, SelectionState may have mutated; Editor.svelte's $effect
	 * mirrors `isCrossBlock` onto `data-cross-block` and SelectionOverlay
	 * components mount/unmount in response. Both happen via Svelte's render
	 * scheduler, not synchronously — assertions reading the DOM before flush
	 * see mid-transition state. Two animation frames cover the worst case
	 * ($effect commit + child component mount). Single-block drags have no
	 * observable signal to predicate on; rAF settle is the cheapest correct
	 * wait for both branches.
	 */
	private async waitForPointerSettle(): Promise<void> {
		await this.page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				})
		);
	}

	/**
	 * Yield long enough for the undo manager's 250ms batch debounce to flush.
	 * Tests that exercise "two separate undo batches" need this between batches —
	 * the next interaction must land outside the prior batch's debounce window
	 * for the undo stack to split. Predicates can't observe this: source already
	 * reflects the typed text, so there is no shape to poll for.
	 */
	async waitForUndoBatchFlush(): Promise<void> {
		await this.page.waitForTimeout(300);
	}

	/**
	 * Yield, then assert the source did not change. Used for "operation should
	 * be a no-op" verifications where the only way to confirm absence-of-mutation
	 * is to wait past the window in which a (wrongly committed) mutation would
	 * surface and then re-read the source. Predicates can't observe a non-event;
	 * 150ms covers a reactivity tick plus a frame of slack.
	 */
	async waitForNoSourceMutation(): Promise<void> {
		await this.page.waitForTimeout(150);
	}

	/**
	 * Yield for one ResizeObserver dispatch cycle. ResizeObserver's
	 * initial-observe callback fires on the frame after mount/attach; without
	 * draining it, a subsequent layout shift triggered in the same callback
	 * batch is absorbed silently and tests that need to observe the shift see
	 * nothing. 120ms covers the post-mount RO dispatch plus a frame of slack.
	 */
	async waitForResizeObserverFlush(): Promise<void> {
		await this.page.waitForTimeout(120);
	}

	/**
	 * Yield until sticky-column layout has settled. Sticky-column assertions
	 * read editor-relative pixel X via `range.getBoundingClientRect()` — that
	 * geometry is only correct after the browser has performed style+layout
	 * for the post-keydown frame. After ArrowUp/ArrowDown (and other reset
	 * triggers — click, Enter, undo, blur), the editor mutates focus/CST,
	 * Svelte's render scheduler commits inline-render updates, and the browser
	 * then repaints; only after that repaint does `getClientRects()` reflect
	 * the caret's new position. A microtask yield isn't enough — we need a
	 * full layout flush. Two animation frames cover render-scheduler commit
	 * plus browser layout. This is the documented `waitForTimeout` carve-out
	 * in docs/testing.md § "Container edits need Svelte's reactivity cycle to
	 * settle" — sticky-column has no observable bridge predicate to poll
	 * (sticky X is internal pixel state, not in the CST source).
	 */
	async waitForStickyColumnSettle(): Promise<void> {
		await this.page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				})
		);
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
