import { test, expect } from '../../fixtures';
import type { Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { attachErrorCollector, type ErrorCollector } from '../../simulation/error-collector';

/**
 * A clean session means something only if the collector would really have failed on a fault, so
 * each test causes one and checks that `assertNone` throws.
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

/** Console messages reach the Node listener asynchronously, so this polls, never reads once. */
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

/** The shape Svelte really emits, `%c` styling included, so the watch is tested against it. */
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
		// Subscribe before the source is replaced; the fault happens after. Passing shows the
		// editor's events object survives a change of the source prop without remounting.
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
		// Give the console event the same time to arrive that the other cases allow.
		await page.waitForTimeout(200);
		await errors.assertNone();
	});
});

// Declared per describe block: at file level it would also cover the tests above, which
// trigger nothing and must stay under the shared watch.
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

// Declaring the code in `test.use` shows the spec's watch saw the warning; waiving it shows the
// collector did. Which codes the shared line parser reads is `dev-warn.test.ts`'s to pin.
test.describe('simulation error collector: the svelte runtime channel', () => {
	const code = 'state_proxy_equality_mismatch';
	test.use({ expectSvelteWarns: [code] });

	test('reds on the runtime warning, and the waiver silences that code', async ({ page }) => {
		await new EditorPage(page).goto();
		const errors = attachErrorCollector(page);
		await errors.start();
		await svelteWarnOnPage(page, code);
		await pollUntilThrows(errors);
		await errors.assertNone([`svelte:${code}`]);
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
