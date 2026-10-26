import { type ConsoleMessage, type Page, type Request, type Response } from '@playwright/test';
import { TYPING_PAUSE_MS } from '../plugins/highlight-occurrences/typing-pause';

// Page-level checks shared across the e2e suites. Whether a spec asserts on what a probe
// collected is its own decision: this module hands it back and never asserts.

/** What a page reported while it loaded: uncaught errors first, then console errors, then one
 *  line per request that failed. `seen` reads what has arrived; `stop` detaches the listeners. */
export interface PageFailures {
	seen(): string[];
	stop(): void;
}

// Attach before navigating: a wait that runs out can then say what the page reported instead of
// only that it waited.
export function watchPageFailures(page: Page): PageFailures {
	const uncaught = new Set<string>();
	const logged = new Set<string>();
	const byUrl = new Map<string, string>();
	const onConsole = (m: ConsoleMessage) => {
		// Chromium logs this line for every bad response, and `byUrl` already names the URL.
		if (m.type() !== 'error' || m.text().startsWith('Failed to load resource')) return;
		logged.add(`console error: ${m.text()}`);
	};
	// Each page error is listed once: an effect that throws on every reactive flush would
	// otherwise bury the cause under thousands of copies of itself.
	const onPageError = (e: Error) => uncaught.add(`page error: ${e.message}`);
	const onRequestFailed = (r: Request) => {
		const reason = r.failure()?.errorText ?? 'no reason given';
		if (!byUrl.has(r.url())) byUrl.set(r.url(), `request failed: ${r.url()} (${reason})`);
	};
	const onResponse = (r: Response) => {
		if (r.status() >= 400 && !byUrl.has(r.url())) {
			byUrl.set(r.url(), `response ${r.status()}: ${r.url()}`);
		}
	};
	page.on('console', onConsole);
	page.on('pageerror', onPageError);
	page.on('requestfailed', onRequestFailed);
	page.on('response', onResponse);
	return {
		seen: () => [...uncaught, ...logged, ...byUrl.values()],
		stop() {
			page.off('console', onConsole);
			page.off('pageerror', onPageError);
			page.off('requestfailed', onRequestFailed);
			page.off('response', onResponse);
		}
	};
}

// A fixed instant rather than the wall clock, advanced one second so a timer set during setup
// fires before the page stops ticking (G4.48).
const FROZEN_AT = new Date('2026-01-01T00:00:00Z');
const FROZEN_UNTIL = new Date('2026-01-01T00:00:01Z');

// Stops every in-page timer (`install` alone keeps them running; `pauseAt` stops them), so a spec
// decides when the typing pause elapses. Call it after setup: the render waits ride rAF.
export async function freezeInPageClock(page: Page): Promise<void> {
	await page.clock.install({ time: FROZEN_AT });
	await page.clock.pauseAt(FROZEN_UNTIL);
}

/** Advance a frozen clock by this to elapse the occurrence plugin's typing pause, with a margin. */
export const PAST_OCCURRENCE_PAUSE_MS = TYPING_PAUSE_MS + 50;

// Whether the top-level block at `index` has a mounted host: false once windowing unmounts it.
export function topLevelHostPresent(page: Page, index: number): Promise<boolean> {
	return page.evaluate(
		(i) => !!document.querySelector(`[data-block-path='${JSON.stringify([i])}']`),
		index
	);
}

// Where keyboard focus sits: the block holding it, and whether it is that block's editable element
// rather than another focus stop inside the block.
export function focusedBlockSurface(
	page: Page
): Promise<{ path: number[] | null; isSurface: boolean }> {
	return page.evaluate(() => {
		const active = document.activeElement as HTMLElement | null;
		const attr = active?.closest('[data-block-path]')?.getAttribute('data-block-path');
		return {
			path: attr ? (JSON.parse(attr) as number[]) : null,
			isSurface: active?.getAttribute('contenteditable') === 'true'
		};
	});
}

/** Leaves every request for `static/test-fixtures/photos/` unanswered, so those images never
 *  decode; call it before the navigation, and assert the returned count of held requests. */
export async function holdFixturePhotos(page: Page): Promise<() => number> {
	let held = 0;
	await page.route('**/test-fixtures/photos/**', () => {
		held++;
	});
	return () => held;
}

/** Holds every image under `https://e2e-deferred.test/` until the returned call, then serves
 *  `svg`, so an image grows at a moment the spec picks rather than during the load. */
export async function deferImage(page: Page, svg: string): Promise<() => void> {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	await page.route('https://e2e-deferred.test/**', async (route) => {
		await gate;
		await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg });
	});
	return release;
}
