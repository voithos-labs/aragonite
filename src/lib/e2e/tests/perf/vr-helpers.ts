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

export function spacerCount(page: Page): Promise<number> {
	return page.evaluate(() => document.querySelectorAll('.vr-spacer').length);
}

// ── Geometry & scroll ───────────────────────────────────────────────

export function editorScrollHeight(page: Page): Promise<number> {
	return page.evaluate(() => (document.querySelector('.editor') as HTMLElement).scrollHeight);
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
	await page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
	);
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
