import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Shared probes for the virtual-rendering e2e suites. Fixtures here clear the editor's
// height watermark so the off-window reveal path runs for real; `UNWINDOWED_PROSE` is the
// deliberate exception. Honest assertions only — a reveal that doesn't land the caret is a
// VR bug to report, not an assertion to soften.

export const FIXTURE_BYTES = 2_000_000;

/**
 * Scrolls but does NOT window: under the activation watermark, so no measure pass recurs
 * after the first. That is what separates two writers of one scrollTop — with windowing
 * active the anchor re-asserts every pass, making re-place and compensate indistinguishable.
 */
export const UNWINDOWED_PROSE = Array.from(
	{ length: 60 },
	(_, i) => `Paragraph ${i} of the header fixture.`
).join('\n\n');

// ── Preconditions & counts ──────────────────────────────────────────

export function cstBlockCount(page: Page): Promise<number> {
	return page.evaluate(() => (window as any).__test.getDocument().children.length);
}

/** Spacers the window emits, document-wide or inside one scope. `scope` is a selector PREFIX,
 *  so `'.table-block >'` counts a grid's own and `'.blockquote-block'` its descendants' too —
 *  the "container windowing is active in this scope" precondition, named. */
export function spacerCount(page: Page, scope = ''): Promise<number> {
	return page.evaluate((s) => document.querySelectorAll(`${s} .vr-spacer`.trim()).length, scope);
}

// ── Geometry & scroll ───────────────────────────────────────────────

/** Two frames: the write lands in one, the measure pass it schedules runs in the next. */
export function settleFrames(page: Page): Promise<void> {
	return page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
	);
}

export function editorScrollHeight(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollHeight);
}

/**
 * The nested analog of a non-uniform flat doc: one blockquote whose `<br>`-heavy children the
 * char estimator under-models ~30×. Blockquote, not list — its paragraph children are
 * BlockHosts enrolled in the scope's `correctAnchor`-wrapped measure pass, whereas list items
 * report through the deliberately-uncorrected subtotal channel.
 */
const NESTED_NON_UNIFORM_CHILDREN = 1000;
export function buildNonUniformBlockquoteDoc(): string {
	const tall = `line${'<br>line'.repeat(30)}`;
	return (
		Array.from({ length: NESTED_NON_UNIFORM_CHILDREN }, () => `> ${tall}`).join('\n>\n') + '\n'
	);
}

// ── Mounted-set coverage floor ──────────────────────────────────────

/** Share of the scrollport either edge may go unmounted before the window has a hole. */
export const MAX_UNMOUNTED_EDGE_FRACTION = 0.15;

export interface ViewportSpan {
	/** Unmounted band between the scrollport's top edge and the first mounted box. */
	topGapPx: number;
	/** Unmounted band between the last mounted box and the scrollport's bottom edge. */
	bottomGapPx: number;
	viewportHeight: number;
}

/**
 * How far the mounted band reaches toward each edge of the editor's scrollport. Every
 * mounted-set CEILING pairs with this floor: a ceiling alone is satisfied by mounting
 * NOTHING, so only the span proves the slice is a window rather than a gap. Extent, not
 * covered area — inter-block margins are honest holes and would sink an area metric.
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
 * The first windowed host whose box clears the editor's viewport top. `cell` measures the
 * row's own `.table-cell`, since a `display:contents` row has no box of its own.
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

/** The host shape where the scroll-host walk finds nothing scrollable and the window's own
 *  viewport is the scrollport. `blocks` sizes the entry across the windowing watermark. */
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

/** The host shape where several editor entries share one ancestor scroller. */
export async function gotoFlow(page: Page): Promise<void> {
	await page.goto('/test/flow');
	await page.waitForFunction(() => (window as any).__flow !== undefined, null, { timeout: 10_000 });
}

/** Below the activation watermark, yet tall enough that a scroll can put nothing but entry
 *  content in the viewport — the same embedding, rendered whole. */
export const UNWINDOWED_ENTRY_BLOCKS = 60;

/** Top-level hosts only — a nested path carries a comma. */
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

/** Measured against the WINDOW viewport, unlike `topVisibleHostTop`: in host mode the
 *  editor's own scrollport starts far above it, so that probe always answers block 0. */
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
 * Steps to `target` so the window mounts and measures every block it passes over: a direct
 * jump leaves them at estimate, where a rebuild's reseed is unobservable. Callers add their
 * own trailing flush.
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
