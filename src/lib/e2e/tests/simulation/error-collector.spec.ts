import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { attachErrorCollector, type ErrorCollector } from '../../simulation/error-collector';

/**
 * A green session is only meaningful if the collector would have FAILED on a real fault, so
 * each test injects one and asserts `assertNone` throws.
 */
async function assertThrows(errors: ErrorCollector): Promise<void> {
	let threw = false;
	try {
		await errors.assertNone();
	} catch {
		threw = true;
	}
	expect(threw).toBe(true);
}

/** Console delivery to the Node listener is async, so a verdict is polled, never read once. */
async function pollUntilThrows(errors: ErrorCollector, waive?: string[]): Promise<void> {
	await expect
		.poll(async () => {
			try {
				await errors.assertNone(waive);
				return 'silent';
			} catch {
				return 'threw';
			}
		})
		.toBe('threw');
}

const warnOnPage = (page: Page, text: string): Promise<void> =>
	page.evaluate((t) => console.warn(t), text);

/** Svelte's own emission shape, `%c` styling included, so the watch is read against the real one. */
const svelteWarnOnPage = (page: Page, code: string): Promise<void> =>
	page.evaluate(
		(c) =>
			console.warn(`%c[svelte] ${c}\n%cinjected fire`, 'font-weight: bold', 'font-weight: normal'),
		code
	);

test.describe('simulation error collector', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('stays silent on a clean session', async ({ page }) => {
		const errors = attachErrorCollector(page);
		await errors.start();
		await editor.loadContent('clean note\n');
		await editor.waitForRenderFlush();
		await errors.assertNone();
	});

	test('catches a structured error event injected after a source resync', async ({ page }) => {
		const errors = attachErrorCollector(page);
		// Subscribe BEFORE the resync; the fault fires after it. A pass proves the
		// editor's events instance survives a source-prop change (no remount).
		await errors.start();
		await editor.loadContent('alpha\n\nbeta\n\ngamma\n');
		await page.evaluate(() => (window as any).__test.makeBlockThrowOnRender(1));
		await editor.waitForRenderFlush();
		await assertThrows(errors);
	});

	test('ignores a page warning that carries no aragonite sentinel', async ({ page }) => {
		const errors = attachErrorCollector(page);
		await errors.start();
		await warnOnPage(page, '[some-dependency] a warning from outside the editor');
		// Give the console event the same delivery window the sentinel tests rely on.
		await page.waitForTimeout(200);
		await errors.assertNone();
	});
});

// Scoped per describe: a file-level declaration would also cover the tests above, which
// trip nothing and so must stay under the shared fixture's watch.
test.describe('simulation error collector: the dev-warn sentinel', () => {
	test.use({ expectWarns: ['tree-ops'] });

	test('reds on a plain dev warning, and the waiver silences that tag', async ({ page }) => {
		await new EditorPage(page).goto();
		const errors = attachErrorCollector(page);
		await errors.start();
		await warnOnPage(page, '[aragonite:tree-ops] injected dev warning');
		await pollUntilThrows(errors);
		await errors.assertNone(['tree-ops']);
	});
});

// Svelte's runtime warns carry no sentinel, so both watches key on the `[svelte] <code>` head
// instead. The `test.use` claim proves the spec watch saw it; the waiver proves the collector did.
test.describe('simulation error collector: the svelte runtime channel', () => {
	test.use({ expectSvelteWarns: ['state_proxy_equality_mismatch'] });

	test('reds on a svelte runtime warning, and the waiver silences that code', async ({ page }) => {
		await new EditorPage(page).goto();
		const errors = attachErrorCollector(page);
		await errors.start();
		await svelteWarnOnPage(page, 'state_proxy_equality_mismatch');
		await pollUntilThrows(errors);
		await errors.assertNone(['svelte:state_proxy_equality_mismatch']);
	});
});

test.describe('simulation error collector: the waiver is per-tag', () => {
	test.use({ expectWarns: ['tree-ops', 'state-registry'] });

	test('waiving one tag leaves every other fire failing', async ({ page }) => {
		await new EditorPage(page).goto();
		const errors = attachErrorCollector(page);
		await errors.start();
		await warnOnPage(page, '[aragonite:state-registry] injected ref-slot fault');
		await warnOnPage(page, '[aragonite:tree-ops] injected dev warning');
		await pollUntilThrows(errors, ['state-registry']);
		const report = await errors.assertNone(['state-registry']).catch((e: Error) => e.message);
		expect(report).toContain('tree-ops');
		expect(report).not.toContain('state-registry');
	});
});

test.describe('simulation error collector: invariant fires', () => {
	test.use({ expectInvariants: ['proof'] });

	test('catches an invariant-marked dev warning', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		const errors = attachErrorCollector(page);
		await errors.start();
		await warnOnPage(page, '[aragonite:invariant:proof] injected violation');
		await pollUntilThrows(errors);
	});
});
