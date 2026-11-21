import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { edgeKey } from '../../platform-keys';

/** A plugin's marker pair (a comment anchor, `{>>id}` and `{<<id}`, on the harness's
 *  `comment-anchor` seed): its sides draw nothing in live mode and give a typed letter to the text
 *  between them, whichever side of the hidden bytes the caret came from. */

const block = (i: number) => `[data-block-path="[${i}]"]`;

test.describe('a marker pair in live mode', () => {
	let editor: PluginsPage;

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('comment-anchor');
		await editor.setPresentationMode('live');
	});

	const source = () => editor.bridge.getSource();
	const text = (i: number) => editor.page.locator(block(i)).innerText();

	/** The caret at the start of block `i`, walked `steps` characters right with the arrow keys. */
	async function walkTo(i: number, steps: number) {
		await editor.focusBlockAtPath([i], 0);
		await editor.page.keyboard.press(edgeKey('lineStart'));
		for (let n = 0; n < steps; n++) await editor.page.keyboard.press('ArrowRight');
	}

	/** The caret at the end of block `i`, walked `steps` characters left. */
	async function walkBackTo(i: number, steps: number) {
		await editor.focusBlockAtPath([i], 0);
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		for (let n = 0; n < steps; n++) await editor.page.keyboard.press('ArrowLeft');
	}

	test('a pair across two blocks draws nothing, and source mode shows its bytes', async () => {
		await expect.poll(() => text(1)).toBe('Across two');
		await expect.poll(() => text(2)).toBe('blocks end');
		await editor.setPresentationMode('source');
		await expect.poll(() => text(1)).toBe('Across {>>b}two');
		await expect.poll(() => text(2)).toBe('blocks{<<b} end');
	});

	test('a letter at the open side joins the text, from outside it', async ({ page }) => {
		await walkTo(1, 'Across '.length);
		await page.keyboard.type('X');
		await expect.poll(source).toContain('Across {>>b}Xtwo\n');
	});

	test('a letter at the open side joins the text, from inside it', async ({ page }) => {
		await walkBackTo(1, 'two'.length);
		await page.keyboard.type('X');
		await expect.poll(source).toContain('Across {>>b}Xtwo\n');
	});

	test('a letter at the close side joins the text, from inside it', async ({ page }) => {
		await walkTo(2, 'blocks'.length);
		await page.keyboard.type('X');
		await expect.poll(source).toContain('blocksX{<<b} end');
	});

	test('a letter at the close side joins the text, from outside it', async ({ page }) => {
		await walkBackTo(2, ' end'.length);
		await page.keyboard.type('X');
		await expect.poll(source).toContain('blocksX{<<b} end');
	});

	// The typed letter leaves the caret past the hidden side, where the browser never puts it.
	test('Backspace beside a side takes the character shown, never the side', async ({ page }) => {
		await walkTo(0, 'A '.length);
		await page.keyboard.type('X');
		await page.keyboard.press('Backspace');
		await expect.poll(source).toMatch(/^A \{>>a\}noted\{<<a\} word\n/);
		await page.keyboard.press('Backspace');
		await expect.poll(source).toMatch(/^A\{>>a\}noted\{<<a\} word\n/);
		await page.keyboard.press('Backspace');
		await expect.poll(source).toMatch(/^\{>>a\}noted\{<<a\} word\n/);
		await expect.poll(() => text(0)).toBe('noted word');
	});

	test('Delete beside a side takes the character shown, from either side of it', async ({
		page
	}) => {
		await walkTo(2, 'blocks'.length);
		await page.keyboard.press('Delete');
		await expect.poll(source).toContain('\nblocks{<<b}end\n');
		await walkTo(1, 'Across '.length);
		await page.keyboard.press('Delete');
		await expect.poll(source).toContain('\nAcross {>>b}wo\n');
	});

	test('Backspace through the text keeps an emptied pair, which holds the caret', async ({
		page
	}) => {
		await walkTo(0, 'A noted'.length);
		for (let n = 0; n < 'noted'.length; n++) await page.keyboard.press('Backspace');
		await expect.poll(source).toMatch(/^A \{>>a\}\{<<a\} word\n/);
		await page.keyboard.type('Y');
		await expect.poll(source).toMatch(/^A \{>>a\}Y\{<<a\} word\n/);
	});

	test('a letter at a loaded empty pair lands between its sides', async ({ page }) => {
		await walkTo(5, 'An '.length);
		await page.keyboard.type('Y');
		await expect.poll(source).toContain('An {>>e}Y{<<e} empty pair');
	});

	test('around a bold, letters join the text and the bold its own', async ({ page }) => {
		await walkTo(3, 'Some '.length);
		await page.keyboard.type('X');
		await expect.poll(source).toContain('Some {>>c}X**bold**{<<c} text');
		await walkTo(3, 'Some Xbold'.length);
		await page.keyboard.type('Y');
		await expect.poll(source).toContain('Some {>>c}X**boldY**{<<c} text');
	});

	test('a side at a line start and one at its end take the letters typed there', async ({
		page
	}) => {
		await walkTo(4, 0);
		await page.keyboard.type('X');
		await editor.page.keyboard.press(edgeKey('lineEnd'));
		await page.keyboard.type('Y');
		await expect.poll(source).toContain('\n{>>d}Xwhole lineY{<<d}\n');
	});

	test('Backspace at a line opening with a side joins the line above', async ({ page }) => {
		await walkTo(4, 0);
		await page.keyboard.press('Backspace');
		await expect.poll(source).toContain('Some {>>c}**bold**{<<c} text{>>d}whole line{<<d}\n');
	});

	test('Enter at a side leaves it whole, on the half with its text', async ({ page }) => {
		await walkBackTo(1, 'two'.length);
		await page.keyboard.press('Enter');
		await expect.poll(source).toContain('Across \n\n{>>b}two\n');
		await walkBackTo(3, ' end'.length);
		await page.keyboard.press('Enter');
		await expect.poll(source).toContain('\nblocks{<<b}\n\n end\n');
	});

	test('Enter at the end of a line closing a pair opens an empty line', async ({ page }) => {
		await walkBackTo(4, 0);
		await page.keyboard.press('Enter');
		await expect.poll(source).toContain('\n{>>d}whole line{<<d}\n\n\n');
		await expect.poll(async () => (await text(5)).trim()).toBe('');
	});

	// `A noted word` is twelve characters: an extra stop at either hidden side would leave the
	// twelfth press one character short of the line's other end.
	test('the arrows cross both sides with no extra stop, either way', async ({ page }) => {
		await walkTo(0, 'A noted word'.length);
		await page.keyboard.type('Z');
		await expect.poll(source).toMatch(/^A \{>>a\}noted\{<<a\} wordZ\n/);
		await walkBackTo(0, 'A noted wordZ'.length);
		await page.keyboard.type('W');
		await expect.poll(source).toMatch(/^WA \{>>a\}noted/);
	});

	test('a side with no partner draws nothing and takes a letter on its text side', async ({
		page
	}) => {
		await expect.poll(() => text(6)).toBe('A lone  side');
		await walkTo(6, 'A lone '.length);
		await page.keyboard.type('X');
		await expect.poll(source).toContain('A lone X{<<x} side');
	});
});

test('preview-inline shows a side at the caret, and hides it away from it', async ({ page }) => {
	const editor = new PluginsPage(page);
	await editor.gotoPlugins('comment-anchor');
	await editor.setPresentationMode('preview-inline');
	await editor.focusBlockAtPath([1], 'Across'.length);
	await expect.poll(() => page.locator(block(1)).innerText()).toBe('Across two');
	await page.keyboard.press('ArrowRight');
	await expect.poll(() => page.locator(block(1)).innerText()).toBe('Across {>>b}two');
});
