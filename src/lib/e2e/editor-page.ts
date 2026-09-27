import { expect, type ConsoleMessage, type Page, type Locator } from '@playwright/test';
import { EditorBridge } from './editor-bridge';
import { createClipboardArm, type ClipboardArm } from './clipboard-arm';
import { generateFixture, type FixtureShape } from '../test/perf/fixtures/generate';
import { BLOCK_CONTENT_LOCATOR_SELECTOR } from '../components/block-content-selector';
import { PAST_TYPING_PAUSE_MS, watchPageFailures } from './page-probes';
import { pointAtRaw } from './text-runs';

// Re-exported so a spec's in-`evaluate` block-content lookup uses the one selector definition
// instead of inlining `:not(.selection-overlay)`.
export { BLOCK_CONTENT_SELECTOR } from '../components/block-content-selector';

/** A ceiling, since a full battery on one dev server slows hydration; it stays under Playwright's
 *  test timeout so a miss reports what the page did (`lint/harness-timeout-headroom.test.ts`). */
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
		const loadSteps = watchLoadSteps(this.page);
		// The navigation, the mount and the bridge share one budget: a full ceiling each would sum
		// past the runner's timeout, and a wait killed by the runner reports none of this.
		const deadline = Date.now() + BRIDGE_INSTALL_TIMEOUT;
		// Playwright reads 0 as "no timeout", so an exhausted budget asks for the smallest wait.
		const budgetLeft = () => Math.max(1, deadline - Date.now());
		const diagnose = async (what: string, cause: unknown): Promise<never> => {
			const reported = failures.seen();
			// Playwright's own message is what separates a timeout from a context destroyed by a
			// reload, which is the other way the bridge goes missing.
			throw new Error(
				[
					`${url}: ${what} in ${BRIDGE_INSTALL_TIMEOUT} ms (${firstLine(cause)}).`,
					'The page reported:',
					...(reported.length > 0 ? reported : ['nothing captured']),
					'Its loads and dev-client lines:',
					...loadSteps.seen(),
					await probeDevServer(this.page)
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
			loadSteps.stop();
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

	/** `loadContent`'s full serialize times out at megabyte scale, so this waits on an in-page
	 *  length check. `suffix` appends markdown, say a sibling block for cross-block navigation. */
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

	// Top-level blocks only (a comma in `data-block-path` marks a nested host); the content selector
	// drops the hover drag handle, so each block matches once.
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

	// Every harness wait defaults to 5s, like expect(): a wait is a ceiling, not a measurement.
	async waitForCrossBlock(active: boolean): Promise<void> {
		if (active) {
			await this.page.waitForSelector('[data-cross-block]', { state: 'attached', timeout: 5000 });
		} else {
			await this.page.waitForSelector('[data-cross-block]', { state: 'detached', timeout: 5000 });
		}
	}

	// ── Cursor Positioning ──────────────────────────────────────────────

	async focusBlockEnd(index: number) {
		await this.placeCaretAtPath([index], 'end');
	}

	async focusBlock(index: number, offset: number) {
		await this.placeCaretAtPath([index], offset);
	}

	async focusBlockStart(index: number) {
		await this.placeCaretAtPath([index], 'start');
	}

	/** Setup only, through the editor's own `setSelection`: a spec whose subject is the click or the
	 *  key drives `clickBlockAtPath` or the keyboard. A container or table takes its first leaf. */
	private async placeCaretAtPath(
		path: number[],
		position: 'start' | 'end' | number
	): Promise<void> {
		const placed = await this.page.evaluate(
			({ path, position }) => (window as any).__test.placeCaret(path, position) as Promise<boolean>,
			{ path, position }
		);
		if (!placed) {
			throw new Error(`placeCaret: the editor declined ${JSON.stringify(path)} @ ${position}`);
		}
	}

	/** `focusBlock` for any path, nested blocks and table cells included. */
	async focusBlockAtPath(path: number[], offset: number): Promise<void> {
		await this.placeCaretAtPath(path, offset);
	}

	// ── User Actions ────────────────────────────────────────────────────

	async clickBlock(index: number) {
		await this.getBlock(index).click();
	}

	/** Reaches the nested blocks `clickBlock` cannot, by resolving the path to a pixel point. */
	async clickBlockAtPath(path: number[], offset: number): Promise<void> {
		const point = await pointAtRaw(this.page, path, offset);
		await this.page.mouse.click(point.x, point.y);
		await this.waitForRenderFlush();
	}

	async typeText(text: string) {
		await this.page.keyboard.insertText(text);
	}

	/** Each character fires its own keydown/input/keyup cycle, unlike `typeText`. */
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
		const start = await pointAtRaw(this.page, startPath, startOffset);
		const end = await pointAtRaw(this.page, endPath, endOffset);

		await this.page.mouse.move(start.x, start.y);
		await this.page.mouse.down();
		await this.dragMouseTo(start, end);
		await this.page.mouse.up();
		await this.waitForRenderFlush();
	}

	/** One held drag through `mid` to `end`; two `dragFromTo` calls would let go in between. */
	async dragFromToThenTo(
		startPath: number[],
		startOffset: number,
		midPath: number[],
		midOffset: number,
		endPath: number[],
		endOffset: number
	): Promise<void> {
		const start = await pointAtRaw(this.page, startPath, startOffset);
		const mid = await pointAtRaw(this.page, midPath, midOffset);
		const end = await pointAtRaw(this.page, endPath, endOffset);

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
		const point = await pointAtRaw(this.page, path, offset);
		await this.page.keyboard.down('Shift');
		await this.page.mouse.click(point.x, point.y);
		await this.page.keyboard.up('Shift');
		await this.waitForRenderFlush();
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

	// ── Waits on rendering and timing ───────────────────────────────────

	/** Two animation frames cover an `$effect` plus a child component mounting, so a DOM read after
	 *  a mutation does not catch it mid-change. */
	async waitForRenderFlush(): Promise<void> {
		await this.page.evaluate(
			() =>
				new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				})
		);
	}

	/** Enter at a list item's end adds an empty item the serialized source trims out, so a
	 *  `getSource()` predicate sees no change; the DOM count does. */
	async waitForListItemCount(expected: number, timeout = 5000): Promise<void> {
		await this.page.waitForFunction(
			(n) => document.querySelectorAll('.list-item-block').length === n,
			expected,
			{ timeout, polling: 16 }
		);
	}

	/** Enter adds a short-lived empty paragraph the serialized source trims out, so the reparsing
	 *  `getBlockCount()` misses it; every block has one `.block-host`. */
	async waitForBlockHostCount(expected: number, timeout = 5000): Promise<void> {
		await this.page.waitForFunction(
			(n) => document.querySelectorAll('.block-host').length === n,
			expected,
			{ timeout, polling: 16 }
		);
	}

	/** A fixed wait: the source already holds the typed text, so nothing marks the typing pause
	 *  ending, and a test wanting two undo entries needs its next input after it. */
	async waitForUndoBatchFlush(): Promise<void> {
		await this.page.waitForTimeout(PAST_TYPING_PAUSE_MS);
	}

	/** Last resort for proving nothing changed after a gesture the editor records no decision for;
	 *  a keyboard gesture is recorded, so it uses `pressDeclined` or `typeDeclined` instead. */
	async waitForNoSourceMutation(): Promise<void> {
		await this.page.waitForTimeout(150);
	}

	/** ResizeObserver's first callback fires the frame after it is attached, and a layout shift in
	 *  that same batch would go unseen. */
	async waitForResizeObserverFlush(): Promise<void> {
		await this.page.waitForTimeout(120);
	}

	/** A copy changes no editor state, so no predicate can watch for it
	 *  (`docs/contributing/testing.md` § Patterns and gotchas). */
	async waitForClipboardWrite(): Promise<void> {
		await this.page.waitForTimeout(150);
	}

	async waitForClipboardContains(expected: string, timeout = 5000): Promise<void> {
		await this.clipboard.waitForContains(expected, timeout);
	}

	// ── Proving nothing happened ────────────────────────────────────────

	/** A key that must change nothing, returning once the editor has recorded whether it handled
	 *  the key, so the caller's source read comes after the handler rather than after a timer. */
	async pressDeclined(key: string): Promise<void> {
		await this.awaitKeydownVerdicts(key, 1, () => this.page.keyboard.press(key));
	}

	/** Per-character typing: one keydown, and so one recorded decision, per character. */
	async typeDeclined(text: string): Promise<void> {
		await this.awaitKeydownVerdicts(text, text.length, () => this.page.keyboard.type(text));
	}

	/** Reading mode records no key decisions, so the signal is that no editable element remains,
	 *  plus one drained tick for whatever an effect would still write. */
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

// ── Page-load diagnosis ─────────────────────────────────────────────

/** Each document the page loaded and each line Vite's client logged, timed from the call: a
 *  reload after Vite re-bundles its dependencies shows as a second load. */
function watchLoadSteps(page: Page): { seen(): string[]; stop(): void } {
	const started = Date.now();
	const steps: string[] = [];
	const at = () => `+${Date.now() - started} ms`;
	const onLoaded = () => steps.push(`${at()} document loaded: ${page.url()}`);
	const onConsole = (m: ConsoleMessage) => {
		if (m.text().startsWith('[vite]')) steps.push(`${at()} ${m.text()}`);
	};
	page.on('domcontentloaded', onLoaded);
	page.on('console', onConsole);
	return {
		seen: () => (steps.length > 0 ? steps : ['none captured']),
		stop() {
			page.off('domcontentloaded', onLoaded);
			page.off('console', onConsole);
		}
	};
}

/** Whether the dev server still answers, asked from the test process: the server's own output
 *  goes to the runner's reporters, which a worker cannot read. */
async function probeDevServer(page: Page): Promise<string> {
	const started = Date.now();
	try {
		const response = await page.request.get('/favicon.svg', { timeout: 5_000 });
		return `The dev server answered /favicon.svg with ${response.status()} in ${Date.now() - started} ms.`;
	} catch (error) {
		return `The dev server did not answer /favicon.svg: ${firstLine(error)}`;
	}
}

function firstLine(error: unknown): string {
	return String(error).split('\n')[0];
}
