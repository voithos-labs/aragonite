import { test, expect } from '../../fixtures';
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

	test('ignores a benign warning without the invariant marker', async ({ page }) => {
		const errors = attachErrorCollector(page);
		await errors.start();
		await page.evaluate(() => console.warn('[some-subsystem] a benign dev warning'));
		// Give the console event the same delivery window the marker test relies on.
		await page.waitForTimeout(200);
		await errors.assertNone();
	});
});

// Scoped to the one test that injects a fire: a file-level waiver would also cover
// the three tests above, which trip no invariant and so must stay under the guard.
test.describe('simulation error collector: invariant marker', () => {
	test.use({ expectInvariants: ['proof'] });

	test('catches an invariant-marked dev warning', async ({ page }) => {
		const editor = new EditorPage(page);
		await editor.goto();
		const errors = attachErrorCollector(page);
		await errors.start();
		await page.evaluate(() => console.warn('[invariant:proof] injected violation'));
		// Console delivery to the Node listener is async; poll until it lands.
		await expect
			.poll(async () => {
				try {
					await errors.assertNone();
					return 'silent';
				} catch {
					return 'threw';
				}
			})
			.toBe('threw');
	});
});
