import { test, expect } from '../../fixtures';
import { PluginsPage, capturedErrors } from './helpers';
import { edgeKey } from '../../platform-keys';

// The alerts plugin's `%> [!TYPE]` container takes Mod+7, which runs its command on the alert
// (requirements/plugins/block-chords.md).

const SEED = 'intro\n\n%> [!NOTE]\n%> inside\n\nafter\n';

test.describe("a block type's key", () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('alerts');
	});

	test.afterEach(async () => {
		expect(await capturedErrors(editor.page)).toEqual([]);
	});

	test('Mod+7 in the paragraph inside the alert cycles its type, one undo step', async ({
		page
	}) => {
		await page.getByText('inside').click();
		await page.keyboard.press('ControlOrMeta+7');
		await expect.poll(() => editor.bridge.getSource()).toContain('%> [!TIP]\n%> inside\n');
		await page.keyboard.press('ControlOrMeta+z');
		await expect.poll(() => editor.bridge.getSource()).toBe(SEED);
	});

	test('Mod+7 in a paragraph outside the alert changes nothing', async ({ page }) => {
		await page.getByText('after').click();
		await page.keyboard.press('ControlOrMeta+7');
		await expect.poll(() => editor.bridge.getSource()).toBe(SEED);
	});

	test("Enter in the alert's paragraph still splits it, a key the paragraph binds itself", async ({
		page
	}) => {
		await page.getByText('inside').click();
		await page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.press('Enter');
		await page.keyboard.type('more');
		await expect.poll(() => editor.bridge.getSource()).toContain('%> [!NOTE]\n%> inside\n');
		await expect.poll(() => editor.bridge.getSource()).toContain('more');
		expect(await editor.bridge.getSource()).not.toContain('[!TIP]');
	});
});
