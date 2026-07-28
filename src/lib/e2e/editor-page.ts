import { type Page, type Locator } from '@playwright/test';
import { primaryModifier } from './platform';
import { EditorBridge } from './editor-bridge';
import { generateFixture, type FixtureShape } from '../test/perf/fixtures/generate';
import {
	BLOCK_CONTENT_SELECTOR,
	BLOCK_CONTENT_LOCATOR_SELECTOR
} from '../components/block-content-selector';

// Re-exported so specs route their in-`evaluate` block-content lookups through the
// one selector definition instead of inlining `:not(.selection-overlay)`.
export { BLOCK_CONTENT_SELECTOR } from '../components/block-content-selector';

export class EditorPage {
	readonly editorContainer: Locator;
	readonly bridge: EditorBridge;

	constructor(public page: Page) {
		this.editorContainer = page.locator('.editor');
		this.bridge = new EditorBridge(page);
	}

	// ── Navigation ──────────────────────────────────────────────────────

	async goto(query = '') {
		await this.page.goto(`/test/editor${query}`);
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

	/**
	 * Load a multi-MB generated fixture for virtual-rendering tests. `loadContent`
	 * polls a full-document serialize with a 2s timeout, which times out at MB
	 * scale; this settles on a cheap in-page doc-length probe (Σ leadingTrivia +
	 * raw, plus prefix/suffix) with a long timeout instead. The fixture is set via
	 * `setSource` (state setup, not a simulated edit) — windowing activates when the
	 * estimated height clears the editor's watermark. `suffix` appends trailing
	 * markdown so a sibling block exists for cross-block navigation.
	 */
	async loadLargeFixture(shape: FixtureShape, bytes: number, suffix = ''): Promise<number> {
		const fixture = generateFixture(shape, bytes) + suffix;
		await this.page.evaluate((c) => (window as any).__test.setSource(c), fixture);
		const minLength = fixture.replace(/\s+$/, '').length;
		await this.page.waitForFunction(
			(min) => {
				const doc = (window as any).__test.getDocument();
				let length = doc.prefix.length + doc.suffix.length;
				for (const child of doc.children) length += child.leadingTrivia.length + child.raw.length;
				return length >= min;
			},
			minLength,
			{ timeout: 90_000, polling: 50 }
		);
		await this.waitForRenderFlush();
		return this.page.evaluate(() => (window as any).__test.getDocument().children.length);
	}

	/** Scroll the editor's internal scroll container to an absolute offset and let
	 *  the window re-slice. The editor scrolls internally, not the page, so
	 *  `page.mouse.wheel` would miss it; a direct scrollTop write fires the passive
	 *  scroll listener the window subscribes to. */
	async scrollEditorTo(scrollTop: number): Promise<void> {
		await this.page.evaluate((top) => {
			const el = document.querySelector('.editor') as HTMLElement | null;
			if (el) el.scrollTop = top;
		}, scrollTop);
		await this.waitForRenderFlush();
	}

	// ── DOM Queries ─────────────────────────────────────────────────────

	// Top-level addressing only. Container blocks (blockquote, list, listItem)
	// render nested BlockHosts whose data-block-path carries a comma; the
	// :not([data-block-path*=","]) filter excludes them. Use focusBlockAtPath
	// for nested addressing. The :not(.block-drag-handle) filter drops the hover
	// reorder grip — also a non-overlay host child — so the count stays one per block.
	getBlock(index: number): Locator {
		return this.page
			.locator(`[data-block-path='${JSON.stringify([index])}']`)
			.locator(BLOCK_CONTENT_LOCATOR_SELECTOR)
			.first();
	}

	getBlocks(): Locator {
		return this.page
			.locator('[data-block-path]:not([data-block-path*=","])')
			.locator(BLOCK_CONTENT_LOCATOR_SELECTOR);
	}

	async getDomBlockCount(): Promise<number> {
		return this.getBlocks().count();
	}

	async getBlockText(index: number): Promise<string> {
		return (await this.getBlock(index).textContent()) ?? '';
	}

	// 5s to match expect()'s default — a wait is a ceiling, not a measurement,
	// and 2s under-provisioned saturated parallel-worker runs.
	async waitForCrossBlock(active: boolean): Promise<void> {
		if (active) {
			await this.page.waitForSelector('[data-cross-block]', { state: 'attached', timeout: 5000 });
		} else {
			await this.page.waitForSelector('[data-cross-block]', { state: 'detached', timeout: 5000 });
		}
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

	// COORDINATE-SPACE WARNING: a numeric `position` here counts ALL text nodes,
	// including `.md-marker` ambient spans — a DOM-textContent offset, NOT the
	// raw-semantic offset `focusBlockAtPath`/`pointForOffset` use (those filter
	// markers). The two spaces are NOT interchangeable on marker-bearing blocks.
	// Divergence pinned by lint/caret-helper-coordinate-spaces.test.ts.
	private async placeCaretInBlock(
		index: number,
		position: 'start' | 'end' | number
	): Promise<void> {
		await this.page.evaluate(
			({ pathAttr, position, contentSelector }) => {
				const wrapper = document.querySelector(`[data-block-path='${pathAttr}']`);
				const block = wrapper?.querySelector(contentSelector) as HTMLElement | null;
				// Throw, never silently return: a selector drift (missing wrapper or
				// editable) must fail the spec, not let a downstream absence-assertion
				// pass for the wrong reason. Mirrors pointForOffset.
				if (!block) throw new Error(`placeCaretInBlock: no editable at ${pathAttr}`);
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
			{ pathAttr: JSON.stringify([index]), position, contentSelector: BLOCK_CONTENT_SELECTOR }
		);
	}

	// COORDINATE-SPACE WARNING: `offset` here is RAW-SEMANTIC — the tree walk
	// filters `.md-marker` ambient spans (see acceptNode below). This is NOT the
	// marker-counting DOM-textContent space `placeCaretInBlock(index, number)` uses.
	// Divergence pinned by lint/caret-helper-coordinate-spaces.test.ts.
	async focusBlockAtPath(path: number[], offset: number): Promise<void> {
		await this.page.evaluate(
			({ path, offset, contentSelector }) => {
				const attr = JSON.stringify(path);
				const wrapper = document.querySelector(`[data-block-path='${attr}']`);
				// Throw, never silently return: selector drift must fail the spec, not
				// green an absence-assertion for the wrong reason. Mirrors pointForOffset.
				if (!wrapper) throw new Error(`focusBlockAtPath: no block wrapper at ${attr}`);
				const block = wrapper.querySelector(contentSelector) as HTMLElement | null;
				if (!block) throw new Error(`focusBlockAtPath: no editable at ${attr}`);
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
			{ path, offset, contentSelector: BLOCK_CONTENT_SELECTOR }
		);
	}

	// ── User Actions ────────────────────────────────────────────────────

	async clickBlock(index: number) {
		await this.getBlock(index).click();
	}

	/**
	 * Real mouse click at a raw-semantic offset inside a nested block. `clickBlock`
	 * addresses top-level blocks only; this resolves any `data-block-path` (including
	 * comma-paths) to a pixel point and clicks it, landing a real caret there. Use
	 * for nested targets a top-level click can't reach.
	 */
	async clickBlockAtPath(path: number[], offset: number): Promise<void> {
		const point = await this.pointForOffset(path, offset);
		await this.page.mouse.click(point.x, point.y);
		await this.waitForRenderFlush();
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

	// ── Drag & Shift+Click ──────────────────────────────────────────────

	async dragFromTo(
		startPath: number[],
		startOffset: number,
		endPath: number[],
		endOffset: number
	): Promise<void> {
		const start = await this.pointForOffset(startPath, startOffset);
		const end = await this.pointForOffset(endPath, endOffset);

		await this.page.mouse.move(start.x, start.y);
		await this.page.mouse.down();
		await this.dragMouseTo(start, end);
		await this.page.mouse.up();
		await this.waitForRenderFlush();
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

		await this.page.mouse.move(start.x, start.y);
		await this.page.mouse.down();
		await this.dragMouseTo(start, mid);
		await this.dragMouseTo(mid, end);
		await this.page.mouse.up();
		await this.waitForRenderFlush();
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
		await this.page.keyboard.down('Shift');
		await this.page.mouse.click(point.x, point.y);
		await this.page.keyboard.up('Shift');
		await this.waitForRenderFlush();
	}

	/** Pixel point of a raw-semantic offset inside any `data-block-path` block. */
	async pointForOffset(path: number[], offset: number): Promise<{ x: number; y: number }> {
		const point = await this.page.evaluate(
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
		if (!point) {
			throw new Error(`pointForOffset: could not resolve ${JSON.stringify(path)} @ ${offset}`);
		}
		return point;
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

	// ── Settle Helpers ──────────────────────────────────────────────────

	/**
	 * Yield two animation frames to let Svelte's render scheduler commit and
	 * the browser perform style+layout. Reads of post-mutation DOM state
	 * (mounted overlays, `data-cross-block`, geometry from `getBoundingClientRect`)
	 * see mid-transition values before this flush. The double-rAF covers an
	 * `$effect` commit plus a child-component mount, or a layout flush after
	 * caret-affecting keystrokes — whichever the caller is waiting on.
	 */
	async waitForRenderFlush(): Promise<void> {
		await this.page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				})
		);
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
	 * Yield until the synthetic clipboard write triggered by Ctrl+C lands on
	 * the system clipboard. The editor's copy handler writes via a synthetic
	 * `copy` event whose flush timing the browser owns; no editor state
	 * changes, so no bridge predicate can observe it. Call before
	 * `navigator.clipboard.readText()` or before a subsequent Ctrl+V that
	 * must see the fresh payload. This is the copy-only carve-out documented
	 * in docs/contributing/testing.md § Patterns and gotchas.
	 */
	async waitForClipboardWrite(): Promise<void> {
		await this.page.waitForTimeout(150);
	}
}
