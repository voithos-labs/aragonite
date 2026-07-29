import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';

// Shared probes for the virtual-rendering (top-level windowing) e2e suites. Every
// fixture in these suites clears the editor's height watermark, so only a window of
// blocks mounts and the off-window reveal path runs for real. Honest assertions
// only — a reveal that doesn't land the caret is a VR bug to report, not an
// assertion to soften.

export const FIXTURE_BYTES = 2_000_000;

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
 * The first windowed host whose box clears the editor's viewport top (the
 * `rect.bottom > top + 1` scroll anchor). `selector` chooses the variant —
 * top-level blocks, nested comma-path hosts, or `[data-table-row-idx]` rows;
 * `cell` measures the row's own `.table-cell`, since a `display:contents` row has
 * no box. `ref` is the matched host's `attr` (a block path or a row idx).
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

/** The host shape where the walk finds nothing scrollable and the window's own
 *  viewport is the scrollport. One editor, `scrollMode="host"`, the standard
 *  `window.__test` bridge plus the fixture's late-image door. */
export async function gotoPageScroll(page: Page): Promise<void> {
	await page.goto('/test/page-scroll');
	await page.waitForFunction(
		() => (window as any).__test !== undefined && (window as any).__pageScroll !== undefined,
		null,
		{ timeout: 10_000 }
	);
}

export async function scrollPageTo(page: Page, top: number): Promise<void> {
	await page.evaluate((t) => window.scrollTo(0, t), top);
	await page.evaluate(
		() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
	);
}

/** The first top-level block whose box reaches the WINDOW viewport's top edge —
 *  what the reader of a page-scrolled embedding is looking at. Distinct from
 *  `topVisibleHostTop`, which measures against the editor's own scrollport: in host
 *  mode that box starts far above the viewport, so it always answers block 0. */
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
 * Scroll from the top to `target` in ~0.6-viewport steps, flushing between, so the
 * window mounts and measures every block it passes over. A direct jump leaves the
 * skipped blocks at estimate, and a rebuild's reseed is only observable where
 * measured heights have replaced them. Callers add their own trailing flush.
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
