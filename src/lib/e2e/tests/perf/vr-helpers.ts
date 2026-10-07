import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { gotoReady, type RouteUrl } from '../../goto-ready';

// Shared checks for the windowing specs. The fixtures are tall enough to pass the editor's height
// threshold, so scrolling to an unmounted block really happens; `UNWINDOWED_PROSE` is the
// exception. A scroll that fails to land the caret is a bug to report, not a check to loosen.

export const FIXTURE_BYTES = 2_000_000;

/** One list or table this size still holds over 5,000 children, far past any window, and loads
 *  in a fraction of the time `FIXTURE_BYTES` of them takes. */
export const GIANT_LIST_OR_TABLE_BYTES = 250_000;

/**
 * Below the windowing threshold, so no measure pass runs after the first: with windowing on, the
 * scroll re-asserts every pass and re-placing looks like correcting.
 */
export const UNWINDOWED_PROSE = Array.from(
	{ length: 60 },
	(_, i) => `Paragraph ${i} of the header fixture.`
).join('\n\n');

// ── Preconditions & counts ──────────────────────────────────────────

export function cstBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.getDocument().children.length);
}

/** `scope` starts a selector, so `'.table-block >'` counts a grid's own spacers and
 *  `'.blockquote-block'` its descendants' too: how a test says windowing runs in that list. */
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

export function editorScrollTop(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollTop);
}

export function editorScrollHeight(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollHeight);
}

/**
 * A blockquote of `<br>`-heavy paragraphs the estimate makes about 30 times too short. Its
 * paragraphs are block hosts in the corrected measure pass; list items report through totals.
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
 * Pairs with every ceiling on mounted blocks, since a ceiling alone is met by mounting nothing.
 * Reach rather than area, because the margins between blocks are real gaps.
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
	const url: RouteUrl =
		blocks === undefined ? '/test/page-scroll' : `/test/page-scroll?blocks=${blocks}`;
	await gotoReady(page, url);
}

/** The layout where several editors share one scrolling ancestor. */
export async function gotoFlow(page: Page): Promise<void> {
	await gotoReady(page, '/test/flow');
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

/** Measured against the window's viewport, unlike `topVisibleHostTop`: when the app scrolls, the
 *  editor's own box starts far above it, so that one always answers block 0. */
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
 * Steps down so every block passed over mounts and is measured, since a jump leaves them at their
 * estimates. Callers add their own flush at the end.
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

/** Counts block hosts added or removed from here on, nested ones and ones torn down within a flush
 *  included. The returned function stops counting and reads the totals. */
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
