import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Shared probes for the windowing specs. The fixtures here are tall enough to pass the editor's
// height threshold, so scrolling to an unmounted block really happens; `UNWINDOWED_PROSE` is the
// deliberate exception. Check what should be true: a scroll that fails to land the caret is a
// bug to report, not a check to loosen.

export const FIXTURE_BYTES = 2_000_000;

/**
 * Scrolls but does not window: below the height at which windowing starts, so no measure pass
 * runs after the first. That is what separates the two things writing one scrollTop: with
 * windowing on, the scroll re-asserts every pass and placing again looks like correcting.
 */
export const UNWINDOWED_PROSE = Array.from(
	{ length: 60 },
	(_, i) => `Paragraph ${i} of the header fixture.`
).join('\n\n');

// ── Preconditions & counts ──────────────────────────────────────────

export function cstBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.getDocument().children.length);
}

/** The spacers windowing produced, across the document or inside one list. `scope` is the start
 *  of a selector, so `'.table-block >'` counts a grid's own and `'.blockquote-block'` its
 *  descendants' as well: it is how a test says windowing is running in that list. */
export function spacerCount(page: Page, scope = ''): Promise<number> {
	return page.evaluate((s) => document.querySelectorAll(`${s} .vr-spacer`.trim()).length, scope);
}

// ── Geometry & scroll ───────────────────────────────────────────────

/** Two frames: the write happens in one, the measure pass it causes runs in the next. */
export function settleFrames(page: Page): Promise<void> {
	return page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
	);
}

export function editorScrollHeight(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollHeight);
}

/**
 * The nested version of an uneven flat document: one blockquote whose children are full of
 * `<br>`, which the character-count estimate makes about 30 times too short. A blockquote rather
 * than a list, because its paragraphs are block hosts and take part in the corrected measure
 * pass, where list items report through the totals, which are corrected on purpose.
 */
const NESTED_NON_UNIFORM_CHILDREN = 1000;
export function buildNonUniformBlockquoteDoc(): string {
	const tall = `line${'<br>line'.repeat(30)}`;
	return (
		Array.from({ length: NESTED_NON_UNIFORM_CHILDREN }, () => `> ${tall}`).join('\n>\n') + '\n'
	);
}

// ── Mounted-set coverage floor ──────────────────────────────────────

/** How much of the viewport either edge may leave unmounted before the window has a hole. */
export const MAX_UNMOUNTED_EDGE_FRACTION = 0.15;

export interface ViewportSpan {
	/** The unmounted stretch between the viewport's top edge and the first mounted block. */
	topGapPx: number;
	/** The unmounted stretch between the last mounted block and the viewport's bottom edge. */
	bottomGapPx: number;
	viewportHeight: number;
}

/**
 * How far the mounted blocks reach toward each edge of the editor's viewport. Every ceiling on
 * how many are mounted pairs with this: a ceiling alone is met by mounting nothing, so only the
 * reach shows the mounted blocks are a window rather than a gap. How far, not how much area is
 * covered: the margins between blocks are real gaps and would sink a measure of area.
 */
export function mountedViewportSpan(page: Page, selector: string): Promise<ViewportSpan> {
	return page.evaluate((sel) => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const port = editorEl.getBoundingClientRect();
		const rects = (Array.from(document.querySelectorAll(`.editor ${sel}`)) as HTMLElement[]).map(
			(el) => el.getBoundingClientRect()
		);
		const tops = rects.map((r) => r.top);
		const bottoms = rects.map((r) => r.bottom);
		return {
			topGapPx: tops.length ? Math.max(0, Math.min(...tops) - port.top) : port.height,
			bottomGapPx: bottoms.length ? Math.max(0, port.bottom - Math.max(...bottoms)) : port.height,
			viewportHeight: port.height
		};
	}, selector);
}

export type VisibleHost = { ref: string | null; top: number };

/**
 * The first mounted block whose box is below the editor's viewport top. `cell` measures the
 * row's own `.table-cell`, since a `display: contents` row has no box of its own.
 */
export function topVisibleHostTop(
	page: Page,
	opts: { selector: string; attr?: string; cell?: boolean }
): Promise<VisibleHost | null> {
	return page.evaluate(({ selector, attr, cell }) => {
		const editorEl = document.querySelector('.editor') as HTMLElement;
		const top = editorEl.getBoundingClientRect().top;
		const hosts = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
		for (const host of hosts) {
			const box = cell ? (host.querySelector(':scope > .table-cell') as HTMLElement | null) : host;
			if (!box) continue;
			const rect = box.getBoundingClientRect();
			if (rect.bottom > top + 1)
				return { ref: host.getAttribute(attr ?? 'data-block-path'), top: rect.top };
		}
		return null;
	}, opts);
}

// ── Page-scrolled host embedding (`/test/page-scroll`) ──────────────

/** The layout where the search for a scrolling ancestor finds none and the window's own
 *  viewport does the scrolling. `blocks` sizes the editor either side of the threshold. */
export async function gotoPageScroll(page: Page, blocks?: number): Promise<void> {
	await page.goto(
		blocks === undefined ? '/test/page-scroll' : `/test/page-scroll?blocks=${blocks}`
	);
	await page.waitForFunction(
		() => (window as any).__test !== undefined && (window as any).__pageScroll !== undefined,
		null,
		{ timeout: 10_000 }
	);
}

/** The layout where several editors share one scrolling ancestor. */
export async function gotoFlow(page: Page): Promise<void> {
	await page.goto('/test/flow');
	await page.waitForFunction(() => (window as any).__flow !== undefined, null, { timeout: 10_000 });
}

/** Below the height at which windowing starts, yet tall enough that a scroll can fill the
 *  viewport with nothing but this editor: the same layout, rendered whole. */
export const UNWINDOWED_ENTRY_BLOCKS = 60;

/** Top-level blocks only, since a nested path carries a comma. */
export const TOP_LEVEL_HOSTS = '[data-block-path]:not([data-block-path*=","])';

export function mountedTopLevelCount(page: Page): Promise<number> {
	return page.evaluate(
		(sel) => document.querySelectorAll(`.editor ${sel}`).length,
		TOP_LEVEL_HOSTS
	);
}

export async function scrollPageTo(page: Page, top: number): Promise<void> {
	await page.evaluate((t) => window.scrollTo(0, t), top);
	await settleFrames(page);
}

/** Measured against the window's viewport, unlike `topVisibleHostTop`: when the app scrolls,
 *  the editor's own box starts far above it, so that probe always answers block 0. */
export function topVisibleBlockInViewport(page: Page): Promise<VisibleHost | null> {
	return page.evaluate(() => {
		const hosts = Array.from(
			document.querySelectorAll('.editor [data-block-path]:not([data-block-path*=","])')
		) as HTMLElement[];
		for (const host of hosts) {
			const rect = host.getBoundingClientRect();
			if (rect.bottom > 1) return { ref: host.getAttribute('data-block-path'), top: rect.top };
		}
		return null;
	});
}

/**
 * Steps down to `target` so every block passed over mounts and is measured: a single jump
 * leaves them at their estimates, where losing a measurement cannot be seen. Callers add their
 * own flush at the end.
 */
export async function progressiveScrollTo(editor: EditorPage, target: number): Promise<void> {
	const viewport = await editor.page.evaluate(
		() => (document.querySelector('.editor') as HTMLElement).clientHeight
	);
	for (let top = 0; top < target; top += Math.round(viewport * 0.6)) {
		await editor.scrollEditorTo(top);
	}
	await editor.scrollEditorTo(target);
}

// ── Host mount counting ─────────────────────────────────────────────

export interface HostChanges {
	added: number;
	removed: number;
}

/** Counts every block host added to or removed from the editor from now on, nested ones inside
 *  an added or removed subtree included, and one mounted and torn down within one flush, which
 *  the settled DOM hides. Call the returned function to stop counting and read the totals. */
export async function startCountingHostChanges(page: Page): Promise<() => Promise<HostChanges>> {
	await page.evaluate(() => {
		const w = window as any;
		w.__hostChanges = { added: 0, removed: 0 };
		const hostsIn = (node: Node) =>
			node instanceof Element
				? Number(node.matches('[data-block-path]')) +
					node.querySelectorAll('[data-block-path]').length
				: 0;
		w.__countHostChanges = (records: MutationRecord[]) => {
			for (const record of records) {
				for (const node of record.addedNodes) w.__hostChanges.added += hostsIn(node);
				for (const node of record.removedNodes) w.__hostChanges.removed += hostsIn(node);
			}
		};
		w.__hostChangeObserver = new MutationObserver(w.__countHostChanges);
		w.__hostChangeObserver.observe(document.querySelector('.editor')!, {
			childList: true,
			subtree: true
		});
	});
	return () =>
		page.evaluate(() => {
			const w = window as any;
			w.__countHostChanges(w.__hostChangeObserver.takeRecords());
			w.__hostChangeObserver.disconnect();
			return w.__hostChanges as { added: number; removed: number };
		});
}
