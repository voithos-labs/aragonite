import { expect, type Page, type Locator } from '@playwright/test';
import { EditorBridge } from './editor-bridge';
import { createClipboardArm, type ClipboardArm } from './clipboard-arm';
import { generateFixture, type FixtureShape } from '../test/perf/fixtures/generate';
import {
	BLOCK_CONTENT_SELECTOR,
	BLOCK_CONTENT_LOCATOR_SELECTOR,
	TABLE_CELL_SELECTOR
} from '../components/block-content-selector';
import { watchPageFailures } from './page-probes';

// Re-exported so a spec's in-`evaluate` block-content lookup uses the one selector definition
// instead of inlining `:not(.selection-overlay)`.
export { BLOCK_CONTENT_SELECTOR } from '../components/block-content-selector';

/** A ceiling on the harness installing `window.__test`, not an expectation of it: a full battery
 *  on one dev server pushes hydration well past the seconds a quiet machine takes. It has to stay
 *  under Playwright's test timeout so the wait reports what the page did instead of being killed
 *  mid-wait, which `lint/harness-timeout-headroom.test.ts` pins. */
export const BRIDGE_INSTALL_TIMEOUT = 45_000;

export class EditorPage {
	readonly editorContainer: Locator;
	readonly bridge: EditorBridge;
	readonly clipboard: ClipboardArm;

	constructor(public page: Page) {
		this.editorContainer = page.locator('.editor');
		this.bridge = new EditorBridge(page);
		this.clipboard = createClipboardArm(page);
	}

	// ── Navigation ──────────────────────────────────────────────────────

	async goto(query = '') {
		await this.clipboard.install();
		await this.openHarness(`/test/editor${query}`);
	}

	/**
	 * Navigate to a harness route and wait for its `window.__test`. Both harnesses come through
	 * here, so a bridge that never arrives names what the page reported rather than only timing out.
	 */
	protected async openHarness(url: string): Promise<void> {
		const failures = watchPageFailures(this.page);
		// The navigation, the mount and the bridge share one budget: a full ceiling each would sum
		// past the runner's timeout, and a wait killed by the runner reports none of this.
		const deadline = Date.now() + BRIDGE_INSTALL_TIMEOUT;
		// Playwright reads 0 as "no timeout", so an exhausted budget asks for the smallest wait.
		const budgetLeft = () => Math.max(1, deadline - Date.now());
		const diagnose = (what: string, cause: unknown): never => {
			const reported = failures.seen();
			// Playwright's own message is what separates a timeout from a context destroyed by a
			// reload, which is the other way the bridge goes missing.
			throw new Error(
				[
					`${url}: ${what} in ${BRIDGE_INSTALL_TIMEOUT} ms (${String(cause).split('\n')[0]}).`,
					'The page reported:',
					...(reported.length > 0 ? reported : ['nothing captured'])
				].join('\n')
			);
		};
		try {
			await this.page.goto(url);
			await this.editorContainer
				.waitFor({ state: 'visible', timeout: budgetLeft() })
				.catch((cause) => diagnose('the editor never mounted', cause));
			await this.page
				.waitForFunction(() => (window as any).__test !== undefined, null, {
					timeout: budgetLeft()
				})
				.catch((cause) => diagnose('the editor mounted but window.__test never arrived', cause));
			// The harness paints a webfont; a caret measured before it arrives is placed by the
			// fallback font's metrics, and the block reflows under the spec.
			await this.page.evaluate(() => document.fonts.ready);
		} finally {
			failures.stop();
		}
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
			{ timeout: 5000, polling: 16 }
		);
		await this.editorContainer.waitFor({ state: 'visible' });
	}

	/** Waits on the attribute, not the call: a mode that never applied falls back to source, where
	 *  most assertions pass anyway and the run goes green without ever entering that mode. */
	async setPresentationMode(mode: string): Promise<void> {
		await this.page.evaluate((m) => (window as any).__test.setPresentationMode(m), mode);
		if (mode === 'source') {
			await expect(this.editorContainer).not.toHaveAttribute('data-presentation');
			return;
		}
		await expect(this.editorContainer).toHaveAttribute('data-presentation', mode);
	}

	/**
	 * `loadContent` waits on a full serialize of the document, which times out at megabyte scale,
	 * so this waits on a cheap in-page length check instead. `suffix` appends markdown so a
	 * sibling block exists for cross-block navigation.
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

	/** The editor scrolls inside its own box, not the page, so `page.mouse.wheel` would miss it;
	 *  writing scrollTop fires the passive listener windowing subscribes with. */
	async scrollEditorTo(scrollTop: number): Promise<void> {
		await this.page.evaluate((top) => {
			const el = document.querySelector('.editor') as HTMLElement | null;
			if (el) el.scrollTop = top;
		}, scrollTop);
		await this.waitForRenderFlush();
	}

	// ── DOM Queries ─────────────────────────────────────────────────────

	// Top-level blocks only: a comma in `data-block-path` marks a nested host, and the content
	// selector drops the hover drag handle, so the count stays one per block. A nested block
	// goes through `focusBlockAtPath`.
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

	// Every harness wait defaults to 5s, the same as expect(): a wait is a ceiling, not a
	// measurement, and 2s was too little for runs with every worker busy.
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

	/**
	 * Places the caret through the editor's own `setSelection`, so it is the text-node caret
	 * every real placement ends in. Setup only: a spec whose subject is the click or the key
	 * drives `clickBlockAtPath` or the keyboard instead. A number is a raw offset; a container
	 * or table takes its first leaf, or its last one for `'end'`.
	 */
	private async placeCaretInBlock(
		index: number,
		position: 'start' | 'end' | number
	): Promise<void> {
		const placed = await this.page.evaluate(
			async ({ pathAttr, position, contentSelector, cellSelector }) => {
				const wrapper = document.querySelector(`[data-block-path='${pathAttr}']`);
				const content = wrapper?.querySelector(contentSelector) as HTMLElement | null;
				// Throws rather than returning quietly: a selector that no longer matches must
				// fail the spec, not let a later "nothing is there" assertion pass for the
				// wrong reason.
				if (!content) throw new Error(`placeCaretInBlock: no editable at ${pathAttr}`);

				const editables = content.matches('[contenteditable="true"]')
					? [content]
					: [...content.querySelectorAll<HTMLElement>('[contenteditable="true"]')];
				// A block with no editable of its own (a rule, an image) takes the caret at its path.
				const leaf = (position === 'end' ? editables.at(-1) : editables[0]) ?? content;

				const owner = leaf.closest('[data-block-path]')!;
				const path = JSON.parse(owner.getAttribute('data-block-path')!) as number[];
				// A table cell has no wrapper of its own; its caret path is [table, row, column].
				if (leaf.matches(cellSelector)) {
					const row = leaf.closest('[data-table-row-idx]') as HTMLElement;
					const cells = [...row.querySelectorAll(`:scope > ${cellSelector}`)];
					path.push(Number(row.dataset.tableRowIdx), cells.indexOf(leaf));
				}
				// `setSelection` clamps an offset past the content to the block's end.
				const offset = position === 'start' ? 0 : position === 'end' ? Infinity : position;
				leaf.focus();
				return (window as any).__test.setSelection({
					anchor: { path, offset },
					focus: { path, offset }
				}) as Promise<boolean>;
			},
			{
				pathAttr: JSON.stringify([index]),
				position,
				contentSelector: BLOCK_CONTENT_SELECTOR,
				cellSelector: TABLE_CELL_SELECTOR
			}
		);
		if (!placed) throw new Error(`placeCaretInBlock: the editor declined [${index}] @ ${position}`);
	}

	// `offset` is a raw offset: the walk skips the container marker spans, which are DOM text
	// but not raw.
	async focusBlockAtPath(path: number[], offset: number): Promise<void> {
		await this.page.evaluate(
			({ path, offset, contentSelector }) => {
				const attr = JSON.stringify(path);
				const wrapper = document.querySelector(`[data-block-path='${attr}']`);
				// Throws rather than returning quietly: a selector that no longer matches must
				// fail the spec, not pass a later "nothing is there" assertion for the wrong reason.
				if (!wrapper) throw new Error(`focusBlockAtPath: no block wrapper at ${attr}`);
				const block = wrapper.querySelector(contentSelector) as HTMLElement | null;
				if (!block) throw new Error(`focusBlockAtPath: no editable at ${attr}`);
				block.focus();

				const range = document.createRange();
				const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
					// The marker spans a container draws (contenteditable="false") count toward
					// DOM text but not toward raw. Callers pass raw offsets.
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
	 * Resolves any `data-block-path`, comma paths included, to a pixel point: the nested blocks
	 * `clickBlock` cannot reach.
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

	async undo() {
		await this.page.keyboard.press('ControlOrMeta+z');
	}

	async redo() {
		await this.page.keyboard.press('ControlOrMeta+Shift+z');
	}

	async selectAll() {
		await this.page.keyboard.press('ControlOrMeta+a');
	}

	// ── Clipboard ───────────────────────────────────────────────────────

	async paste(): Promise<void> {
		await this.clipboard.paste();
	}

	async seedClipboard(text: string): Promise<void> {
		await this.clipboard.seed(text);
	}

	async readClipboard(): Promise<string> {
		return this.clipboard.read();
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

	/** One held drag through `mid` to `end`: two `dragFromTo` calls would release and press the
	 *  button again in between. */
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

	/** Pixel point of a raw offset inside any `data-block-path` block. */
	async pointForOffset(path: number[], offset: number): Promise<{ x: number; y: number }> {
		const point = await this.page.evaluate(
			({ path, offset }) => {
				const wrapper = document.querySelector(`[data-block-path='${JSON.stringify(path)}']`);
				const editable = wrapper?.querySelector('[contenteditable]') as HTMLElement | null;
				if (!editable) return null;
				const range = document.createRange();
				let remaining = offset;
				const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT, {
					// The marker spans a container draws (contenteditable="false") count toward
					// DOM text but not toward raw. Callers pass raw offsets.
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
	 * Without this, a read of DOM state after a mutation (mounted overlays, `data-cross-block`,
	 * geometry) catches it mid-change. Two animation frames cover an `$effect` plus a child
	 * component mounting, or a layout pass after a keystroke that moved the caret.
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
	 * Enter at the end of a list item inserts an empty trailing item whose marker is trimmed out
	 * of the serialized source, so a `getSource()` predicate sees no change. The DOM count is the
	 * cheapest sign that the tree after Enter has rendered.
	 */
	async waitForListItemCount(expected: number, timeout = 5000): Promise<void> {
		await this.page.waitForFunction(
			(n) => document.querySelectorAll('.list-item-block').length === n,
			expected,
			{ timeout, polling: 16 }
		);
	}

	/**
	 * Enter inserts a short-lived empty paragraph whose marker is trimmed out of the serialized
	 * source, so `getBlockCount()`, which re-parses it, cannot see it. Every block is wrapped in
	 * a `.block-host`, so that total moves by one per insertion.
	 */
	async waitForBlockHostCount(expected: number, timeout = 5000): Promise<void> {
		await this.page.waitForFunction(
			(n) => document.querySelectorAll('.block-host').length === n,
			expected,
			{ timeout, polling: 16 }
		);
	}

	/**
	 * A fixed wait, not a predicate: the source already holds the typed text, so there is nothing
	 * to poll for. A test that wants two separate undo entries needs its next interaction to
	 * happen after the previous batch's debounce window.
	 */
	async waitForUndoBatchFlush(): Promise<void> {
		await this.page.waitForTimeout(300);
	}

	/**
	 * The last resort for proving nothing changed, for a gesture the editor records no decision
	 * for: a click, a drag, a paste, a menu item, a direct call. Nothing can be polled for an
	 * event that never happens, so this waits past the window a wrongly committed mutation would
	 * show up in. A keyboard gesture is recorded: use `pressDeclined` or `typeDeclined` instead.
	 */
	async waitForNoSourceMutation(): Promise<void> {
		await this.page.waitForTimeout(150);
	}

	/**
	 * ResizeObserver's first callback fires the frame after it is attached; without waiting that
	 * out, a layout shift in the same batch of callbacks is absorbed silently and the test
	 * watching for that shift sees nothing.
	 */
	async waitForResizeObserverFlush(): Promise<void> {
		await this.page.waitForTimeout(120);
	}

	/**
	 * The copy handler writes through a synthetic `copy` event whose timing the browser owns, and
	 * no editor state changes, so no predicate can watch for it. The copy-only exception is in
	 * docs/contributing/testing.md § Patterns and gotchas.
	 */
	async waitForClipboardWrite(): Promise<void> {
		await this.page.waitForTimeout(150);
	}

	async waitForClipboardContains(expected: string, timeout = 5000): Promise<void> {
		await this.clipboard.waitForContains(expected, timeout);
	}

	// ── Proving nothing happened ────────────────────────────────────────

	/**
	 * Press a key that must change nothing, returning once the editor has recorded whether it
	 * handled the key: the block's handler has finished, so the caller's source read comes after
	 * the gesture rather than after a timer.
	 */
	async pressDeclined(key: string): Promise<void> {
		await this.awaitKeydownVerdicts(key, 1, () => this.page.keyboard.press(key));
	}

	/** Per-character typing: one keydown, and so one recorded decision, per character. */
	async typeDeclined(text: string): Promise<void> {
		await this.awaitKeydownVerdicts(text, text.length, () => this.page.keyboard.type(text));
	}

	/**
	 * Reading mode takes no keystrokes, so there is no recorded decision to wait on. The signal
	 * is the structure instead: the editor root holds no editable element, plus one drained tick
	 * for whatever an effect would still write.
	 */
	async expectSurfaceInert(): Promise<void> {
		try {
			await this.page.waitForFunction(
				() => document.querySelectorAll('.editor [contenteditable="true"]').length === 0,
				null,
				{ timeout: 5000, polling: 16 }
			);
		} catch {
			const live = await this.editorContainer.locator('[contenteditable="true"]').count();
			throw new Error(`expectSurfaceInert: ${live} editable surface(s) under the editor root`);
		}
		await this.page.evaluate(() => (window as any).__test.drainTick());
	}

	/**
	 * A count that never advances is a finding, not a timeout to widen: the key reached no
	 * editable element, so the gesture the spec believes it made never happened.
	 */
	private async awaitKeydownVerdicts(
		gesture: string,
		expected: number,
		dispatch: () => Promise<void>
	): Promise<void> {
		const before = await this.page.evaluate(() => {
			const trace = (window as any).__test.trace;
			trace.enable();
			return trace.keydownCount() as number;
		});
		await dispatch();
		try {
			await this.page.waitForFunction(
				(target) => ((window as any).__test.trace.keydownCount() as number) >= target,
				before + expected,
				{ timeout: 5000, polling: 16 }
			);
		} catch {
			const after = await this.page.evaluate(
				() => (window as any).__test.trace.keydownCount() as number
			);
			throw new Error(
				`no keydown verdict for '${gesture}': the editor recorded ${after - before} of ` +
					`${expected} (count ${before} → ${after}), so the key reached no editor surface`
			);
		}
	}
}
