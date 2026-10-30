import type { ConsoleMessage, Page } from '@playwright/test';
import { watchPageFailures } from './page-probes';
import { holdTypingBatches } from './typing-batch';

// Every e2e navigation, so a spec acts only on a hydrated route: a server-rendered route paints
// its markup before any handler attaches, and only the route's readiness global says they have.

/** The global a route assigns from a client-only effect once its editors mounted. */
type ReadyGlobal =
	| '__test'
	| '__parityDocuments'
	| '__activation'
	| '__syntax'
	| '__editorsReady'
	| '__flow'
	| '__pageScroll';

/** Each route's readiness global: its own when its specs read one, else the `__parityDocuments`
 *  list that every route with an editor fills. A route missing here fails `gotoReady`'s type. */
const READY_BY_ROUTE = {
	'/': '__parityDocuments',
	'/changelog': '__parityDocuments',
	'/test/editor': '__test',
	'/test/flow': '__flow',
	'/test/host-chords': '__parityDocuments',
	'/test/host-fill': '__parityDocuments',
	'/test/host-theme': '__parityDocuments',
	'/test/multi-editor': '__editorsReady',
	'/test/no-reset': '__test',
	'/test/page-scroll': '__pageScroll',
	'/test/plugins': '__test',
	'/test/plugins/activation': '__activation',
	'/test/plugins/enablement': '__parityDocuments',
	'/test/plugins/multi': '__parityDocuments',
	'/test/plugins/staggered': '__test',
	'/test/syntax': '__syntax'
} as const satisfies Record<string, ReadyGlobal>;

type Route = keyof typeof READY_BY_ROUTE;

/** A route from the table, optionally with a query. */
export type RouteUrl = Route | `${Route}?${string}`;

/** A ceiling, since a full battery on one server slows hydration; it stays under Playwright's
 *  test timeout so a miss reports what the page did (`lint/harness-timeout-headroom.test.ts`). */
export const READY_TIMEOUT = 45_000;

// Not `load`: Firefox holds it until the app has booted, so an image the editor requests by then
// and a spec's route never answers holds it forever. The readiness global is the signal.
const NAVIGATED = 'domcontentloaded';

export function gotoReady(page: Page, url: RouteUrl): Promise<void> {
	const ready = READY_BY_ROUTE[url.split('?')[0] as Route];
	return navigateReady(page, url, ready, (timeout) =>
		page.goto(url, { timeout, waitUntil: NAVIGATED })
	);
}

/** Loads `url` with every script request held unanswered, so a spec reads the page as served,
 *  before the app hydrates it; inline scripts in the markup still run. */
export function gotoUnhydrated(page: Page, url: RouteUrl): Promise<void> {
	return navigateFrom(page, readyBudget(), async (timeout) => {
		// Installed once the page it leaves has loaded, so only the new page's scripts are held.
		await page.route('**/*', (route) =>
			route.request().resourceType() === 'script' ? undefined : route.fallback()
		);
		await page.goto(url, { timeout, waitUntil: NAVIGATED });
	});
}

export function reloadReady(page: Page): Promise<void> {
	const url = page.url();
	const route = new URL(url).pathname;
	if (!(route in READY_BY_ROUTE)) throw new Error(`reloadReady: ${route} has no readiness global`);
	const ready = READY_BY_ROUTE[route as Route];
	return navigateReady(page, url, ready, (timeout) =>
		page.reload({ timeout, waitUntil: NAVIGATED })
	);
}

async function navigateReady(
	page: Page,
	url: string,
	ready: ReadyGlobal,
	navigate: (timeout: number) => Promise<unknown>
): Promise<void> {
	const failures = watchPageFailures(page);
	const loadSteps = watchLoadSteps(page);
	// The navigation, the mount and the global share one budget: a full ceiling each would sum
	// past the runner's timeout, and a wait killed by the runner reports none of this.
	const started = Date.now();
	const budgetLeft = readyBudget();
	const diagnose = async (what: string, cause: unknown): Promise<never> => {
		const elapsed = Date.now() - started;
		const reported = failures.seen();
		// The probe first, so a document that loads while it runs is in the list below.
		const server = await probeAppServer(page);
		// Playwright's own message is what separates a timeout from a context destroyed by a
		// reload, which is the other way the global goes missing.
		throw new Error(
			[
				`${url}: ${what} after ${elapsed} of ${READY_TIMEOUT} ms (${firstLine(cause)}).`,
				'The page reported:',
				...(reported.length > 0 ? reported : ['nothing captured']),
				'Its loads and dev-client lines:',
				...loadSteps.seen(),
				server
			].join('\n')
		);
	};
	try {
		await navigateFrom(page, budgetLeft, navigate).catch((cause) =>
			diagnose('the navigation never finished', cause)
		);
		await page
			.locator('.editor')
			.first()
			.waitFor({ state: 'visible', timeout: budgetLeft() })
			.catch((cause) => diagnose('no editor ever mounted', cause));
		await page
			.waitForFunction((name) => (window as any)[name] !== undefined, ready, {
				timeout: budgetLeft()
			})
			.catch((cause) => diagnose(`an editor mounted but window.${ready} never arrived`, cause));
		// The routes paint a webfont; a caret measured before it arrives is placed by the
		// fallback font's metrics, and the block reflows under the spec.
		await page.evaluate(() => document.fonts.ready);
		await holdTypingBatches(page);
	} finally {
		failures.stop();
		loadSteps.stop();
	}
}

/** The milliseconds left of a `READY_TIMEOUT` that starts now. */
function readyBudget(): () => number {
	const deadline = Date.now() + READY_TIMEOUT;
	// Playwright reads 0 as "no timeout", so an exhausted budget asks for the smallest wait.
	return () => Math.max(1, deadline - Date.now());
}

// ── Leaving a page ──────────────────────────────────────────────────

/** Every navigation starts here, once the page's document and images finished loading: Firefox
 *  turns a cut-off load into a page error or a `page.goto` "interrupted" by its own URL. */
async function navigateFrom(
	page: Page,
	budgetLeft: () => number,
	navigate: (timeout: number) => Promise<unknown>
): Promise<void> {
	await page
		.waitForFunction(
			() => document.readyState === 'complete' && [...document.images].every((img) => img.complete),
			undefined,
			{ timeout: budgetLeft() }
		)
		.catch(async (cause) => {
			const loading = await page
				.evaluate(() =>
					[...document.images]
						.filter((img) => !img.complete)
						.map((img) => img.currentSrc || img.src)
				)
				.catch(() => []);
			throw new Error(
				`the page it was leaving, ${page.url()}, never finished loading (${firstLine(cause)}); ` +
					`images still loading: ${loading.join(', ') || 'none'}`
			);
		});
	await navigate(budgetLeft());
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

/** Whether the app server still answers, asked from the test process: the server's own output
 *  goes to the runner's reporters, which a worker cannot read. */
async function probeAppServer(page: Page): Promise<string> {
	const started = Date.now();
	try {
		const response = await page.request.get('/favicon.svg', { timeout: 5_000 });
		return `The app server answered /favicon.svg with ${response.status()} in ${Date.now() - started} ms.`;
	} catch (error) {
		return `The app server did not answer /favicon.svg: ${firstLine(error)}`;
	}
}

function firstLine(error: unknown): string {
	return String(error).split('\n')[0];
}
