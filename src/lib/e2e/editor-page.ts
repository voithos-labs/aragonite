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

/** Hang guard on the harness installing `window.__test`, not a budget for it: a battery
 *  saturating one dev server pushes hydration well past the seconds a quiet host takes. */
export const BRIDGE_INSTALL_TIMEOUT = 60_000;

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
			timeout: BRIDGE_INSTALL_TIMEOUT
		});
	}

	async loadContent(md: string) {
		await this.page.evaluate((content) => {
			(window as any).__test.setSource(content);
		}, md);
		// serialize() normalizes trailing whitespace; compare on trimmed forms.
		await this.page.waitForFunction(
			(expected) => {
				const actual = (window as any).__test?.getSource() as string | undefined;
				if (actual === undefined) return false;
				return actual.replace(/\s+$/, '') === expected.replace(/\s+$/, '');
			},
			md,
			{ timeout: 2000, polling: 16 }
		);
		await this.editorContainer.waitFor({ state: 'visible' });
	}

	/**
	 * `loadContent` polls a full-document serialize with a 2s timeout, which times out at MB
	 * scale, so this settles on a cheap in-page doc-length probe instead. `suffix` appends
	 * trailing markdown so a sibling block exists for cross-block navigation.
	 */
	async loadLargeFixture(shape: FixtureShape, bytes: number, suffix = ''): Promise<number> {
		const fixture = generateFixture(shape, bytes) + suffix;
		await this.page.evaluate((c) => (window as any).__test.setSource(c), fixture);
		const minLength = fixture.replace(/\s+$/, '').length;
		await this.page.waitForFunction(
			(min) => {
				const doc = (window as any).__test?.getDocument();
				if (!doc) return false;
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

	/** The editor scrolls INTERNALLY, not the page, so `page.mouse.wheel` would miss it; a
	 *  direct scrollTop write fires the passive listener the window subscribes to. */
	async scrollEditorTo(scrollTop: number): Promise<void> {
		await this.page.evaluate((top) => {
			const el = document.querySelector('.editor') as HTMLElement | null;
			if (el) el.scrollTop = top;
		}, scrollTop);
		await this.waitForRenderFlush();
	}

	// ── DOM Queries ─────────────────────────────────────────────────────

	// Top-level addressing only: a comma in `data-block-path` marks a nested host, and the
	// drag-handle filter drops the hover grip, so the count stays one per block. Nested
	// addressing goes through `focusBlockAtPath`.
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

	/** The live tree still matches a reparse of its own serialization (see `testing/parse-convergence`). */
	async parseConverged(): Promise<boolean> {
		return this.page.evaluate(() => (window as any).__test.parseConverged() as boolean);
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

	// COORDINATE-SPACE WARNING: a numeric `position` is a DOM-textContent offset counting
	// `.md-marker` spans, NOT the raw-semantic offset `focusBlockAtPath` uses — the two are not
	// interchangeable on marker-bearing blocks. Pinned by
	// lint/caret-helper-coordinate-spaces.test.ts.
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

	// COORDINATE-SPACE WARNING: `offset` is RAW-SEMANTIC — the walk filters `.md-marker`
	// spans — NOT the marker-counting space `placeCaretInBlock(index, number)` uses. Pinned
	// by lint/caret-helper-coordinate-spaces.test.ts.
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
	 * Resolves ANY `data-block-path`, comma-paths included, to a pixel point — the nested
	 * targets `clickBlock`'s top-level-only addressing cannot reach.
	 */
	async clickBlockAtPath(path: number[], offset: number): Promise<void> {
		const point = await this.pointForOffset(path, offset);
		await this.page.mouse.click(point.x, point.y);
		await this.waitForRenderFlush();
	}

	async typeText(text: string) {
		await this.page.keyboard.insertText(text);
	}

	/** Each character fires its own keydown/input/keyup cycle, for tests where per-keystroke
	 *  behavior matters (formatting, kind changes). */
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

	/** One held drag through `mid` to `end`: two `dragFromTo` calls would release and
	 *  re-press between segments. */
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
	 * Reads of post-mutation DOM state (mounted overlays, `data-cross-block`, geometry) see
	 * mid-transition values before this. The DOUBLE rAF covers an `$effect` commit plus a
	 * child-component mount, or a layout flush after caret-affecting keystrokes.
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
	 * Enter at the end of a list item inserts an empty trailing item whose marker is TRIMMED in
	 * the serialized source, so `getSource()` predicates see no change. DOM count is the
	 * cheapest signal that the post-Enter tree flushed.
	 */
	async waitForListItemCount(expected: number, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(n) => document.querySelectorAll('.list-item-block').length === n,
			expected,
			{ timeout, polling: 16 }
		);
	}

	/**
	 * Enter inserts a transient empty paragraph whose marker is TRIMMED in the serialized
	 * source, so `getBlockCount()` — which re-parses it — cannot see it. Every block wraps in
	 * `.block-host`, so the total moves by one per insertion.
	 */
	async waitForBlockHostCount(expected: number, timeout = 2000): Promise<void> {
		await this.page.waitForFunction(
			(n) => document.querySelectorAll('.block-host').length === n,
			expected,
			{ timeout, polling: 16 }
		);
	}

	/**
	 * A fixed wait, not a predicate: the source already reflects the typed text, so there is no
	 * shape to poll for. Tests wanting two separate undo batches need the next interaction to
	 * land outside the prior batch's debounce window.
	 */
	async waitForUndoBatchFlush(): Promise<void> {
		await this.page.waitForTimeout(300);
	}

	/**
	 * A predicate cannot observe a NON-event, so absence of mutation is confirmed by waiting
	 * past the window a wrongly-committed mutation would surface in, then re-reading.
	 */
	async waitForNoSourceMutation(): Promise<void> {
		await this.page.waitForTimeout(150);
	}

	/**
	 * ResizeObserver's initial-observe callback fires the frame after attach; without draining
	 * it, a layout shift in the same callback batch is absorbed silently and the test observing
	 * that shift sees nothing.
	 */
	async waitForResizeObserverFlush(): Promise<void> {
		await this.page.waitForTimeout(120);
	}

	/**
	 * The copy handler writes through a synthetic `copy` event whose flush timing the BROWSER
	 * owns, and no editor state changes, so no bridge predicate can observe it. The copy-only
	 * carve-out in docs/contributing/testing.md § Patterns and gotchas.
	 */
	async waitForClipboardWrite(): Promise<void> {
		await this.page.waitForTimeout(150);
	}
}
