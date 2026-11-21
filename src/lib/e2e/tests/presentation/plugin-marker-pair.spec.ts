import { test, expect } from '../../fixtures';
import { PluginsPage } from '../plugins/helpers';
import { WORD_MODIFIER, edgeKey } from '../../platform-keys';
import { pointAtRaw, textRunStart } from '../../text-runs';
import { holdSelectionDrag } from '../../selection-drag';

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

	// The arrows may leave the caret on either side of the hidden side; the typed letter, past it.
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

	// The arrows leave the caret inside the bold's hidden closer, beside the side.
	for (const from of ['left', 'right'] as const) {
		test(`Enter at a side closing against a bold keeps the side, from the ${from}`, async ({
			page
		}) => {
			if (from === 'left') await walkTo(3, 'Some bold'.length);
			else await walkBackTo(3, ' text'.length);
			await page.keyboard.press('Enter');
			await expect.poll(source).toContain('Some {>>c}**bold**{<<c}\n\n text\n');
		});
	}

	test('Enter at a side closing against a link keeps the side', async ({ page }) => {
		await editor.loadContent('x {>>a}[link](https://x.dev){<<a} y\n');
		await walkTo(0, 'x link'.length);
		await page.keyboard.press('Enter');
		await expect.poll(source).toBe('x {>>a}[link](https://x.dev){<<a}\n\n y\n');
	});

	test('two anchors on one word take a letter and Enter as one does', async ({ page }) => {
		await editor.loadContent('x {>>a}{>>b}text{<<b}{<<a} y\n');
		await walkTo(0, 'x '.length);
		await page.keyboard.type('X');
		await expect.poll(source).toBe('x {>>a}{>>b}Xtext{<<b}{<<a} y\n');
		await walkTo(0, 'x Xtext'.length);
		await page.keyboard.press('Enter');
		await expect.poll(source).toBe('x {>>a}{>>b}Xtext{<<b}{<<a}\n\n y\n');
		await walkTo(0, 'x '.length);
		await page.keyboard.press('Enter');
		await expect.poll(source).toBe('x \n\n{>>a}{>>b}Xtext{<<b}{<<a}\n\n y\n');
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

// A removal across a side, with real keys: the half kept keeps its pair (`live-mode.md` § 4.5).
// Block 0 is `A {>>a}noted{<<a} word`.
test.describe('a live removal across a side', () => {
	let editor: PluginsPage;
	const SEED_LINE = 'A {>>a}noted{<<a} word\n';

	test.beforeEach(async ({ page }) => {
		editor = new PluginsPage(page);
		await editor.gotoPlugins('comment-anchor');
		await editor.setPresentationMode('live');
	});

	const source = () => editor.bridge.getSource();
	const line = async (i: number) => (await source()).split('\n\n')[i];
	async function walk(i: number, steps: number, from: 'lineStart' | 'lineEnd' = 'lineStart') {
		await editor.focusBlockAtPath([i], 0);
		await editor.page.keyboard.press(edgeKey(from));
		const key = from === 'lineStart' ? 'ArrowRight' : 'ArrowLeft';
		for (let n = 0; n < steps; n++) await editor.page.keyboard.press(key);
	}
	async function press(key: string, times = 1) {
		for (let n = 0; n < times; n++) await editor.page.keyboard.press(key);
	}
	/** Undo gives the seed's first line back. */
	async function undone() {
		await press('ControlOrMeta+z');
		await expect.poll(async () => (await source()).startsWith(SEED_LINE)).toBe(true);
	}

	test('a word delete after the commented word keeps both sides', async () => {
		await walk(0, 'word'.length, 'lineEnd');
		await press(`${WORD_MODIFIER}+Backspace`);
		await expect.poll(() => line(0)).toBe('A {>>a}{<<a}word');
		await undone();
	});

	test('a word delete forward from outside the open side keeps both sides', async () => {
		await walk(0, 'A '.length);
		await press(`${WORD_MODIFIER}+Delete`);
		await expect.poll(() => line(0)).toMatch(/^A \{>>a\}\{<<a\} ?word$/);
		await undone();
	});

	test('a word delete of the whole commented word leaves an empty pair a letter lands in', async () => {
		await walk(0, 'A noted'.length);
		await press(`${WORD_MODIFIER}+Backspace`);
		await expect.poll(() => line(0)).toBe('A {>>a}{<<a} word');
		await editor.page.keyboard.type('Q');
		await expect.poll(() => line(0)).toBe('A {>>a}Q{<<a} word');
	});

	test('a range across the open side puts the side back before the kept text', async () => {
		await walk(0, 'A no'.length);
		await press('Shift+ArrowLeft', 3);
		await press('Backspace');
		await expect.poll(() => line(0)).toBe('A{>>a}ted{<<a} word');
		await undone();
	});

	test('a range across the close side puts the side back after the kept text', async () => {
		await walk(0, 'A not'.length);
		await press('Shift+ArrowRight', 3);
		await press('Backspace');
		await expect.poll(() => line(0)).toBe('A {>>a}not{<<a}word');
		await undone();
	});

	test('a letter typed over a range across the open side joins the pair', async () => {
		await walk(0, 'A no'.length);
		await press('Shift+ArrowLeft', 3);
		await editor.page.keyboard.type('Q');
		await expect.poll(() => line(0)).toBe('A{>>a}Qted{<<a} word');
		await undone();
	});

	test('a letter typed over the commented text exactly stays in the pair', async () => {
		await walk(0, 'A '.length);
		await press('Shift+ArrowRight', 'noted'.length);
		await editor.page.keyboard.type('Q');
		await expect.poll(() => line(0)).toBe('A {>>a}Q{<<a} word');
		await undone();
	});

	test('a range past both sides takes the pair', async () => {
		await walk(0, 'A'.length);
		await press('Shift+ArrowRight', ' noted '.length);
		await press('Backspace');
		await expect.poll(() => line(0)).toBe('Aword');
		await undone();
	});

	test('a range across two blocks keeps a pair spanning them', async ({ page }) => {
		await walk(1, 'Acr'.length);
		const end = await pointAtRaw(page, [2], 'blo'.length);
		await page.keyboard.down('Shift');
		await page.mouse.click(end.x, end.y);
		await page.keyboard.up('Shift');
		await press('Backspace');
		await expect.poll(() => line(1)).toBe('Acr{>>b}cks{<<b} end');
	});

	test('a word delete inside a pair around a bold keeps both sides', async () => {
		await walk(3, ' text'.length, 'lineEnd');
		await press(`${WORD_MODIFIER}+Backspace`);
		await expect.poll(() => line(3)).toBe('Some {>>c}{<<c} text');
	});

	test('a cut pasted back keeps one pair', async () => {
		await walk(0, 'A not'.length);
		await press('Shift+ArrowRight', 3);
		await press('ControlOrMeta+x');
		await expect.poll(() => line(0)).toBe('A {>>a}not{<<a}word');
		await editor.paste();
		await expect.poll(() => line(0)).toBe('A {>>a}noted{<<a} word');
	});

	test('a dragged range carries no side its pair keeps', async ({ page }) => {
		await walk(0, 'A not'.length);
		await press('Shift+ArrowRight', 3);
		const grab = await pointAtRaw(page, [0], 'A {>>a}note'.length);
		const drag = await holdSelectionDrag(page, grab, await textRunStart(page, 'empty pair'));
		await drag.release();
		await expect.poll(() => line(0)).toBe('A {>>a}not{<<a}word');
		await expect.poll(async () => (await source()).split('{<<a}').length).toBe(2);
	});

	test('formatted text pasted into a bold a pair holds writes no second pair', async () => {
		await editor.seedClipboard('**x** y');
		await walk(3, 'Some bo'.length);
		await editor.paste();
		await expect.poll(() => line(3)).toBe('Some {>>c}**box** y**ld**{<<c} text');
	});

	test('a cut of the whole line a pair wraps carries the pair, and a paste brings it back', async () => {
		await walk(4, 'who'.length);
		await press('ControlOrMeta+a');
		await press('ControlOrMeta+x');
		await expect.poll(source).not.toContain('{>>d}');
		expect(await editor.readClipboard()).toBe('{>>d}whole line{<<d}');
		await walk(6, 0, 'lineEnd');
		await editor.paste();
		await expect.poll(source).toContain('A lone {<<x} side{>>d}whole line{<<d}');
	});

	test('source mode takes the bytes selected, sides with them', async () => {
		await editor.setPresentationMode('source');
		await walk(0, 'A {>>a}not'.length);
		await press('Shift+ArrowRight', 'ed{<<a} '.length);
		await press('Backspace');
		await expect.poll(() => line(0)).toBe('A {>>a}notword');
	});

	test('a word delete across one end of a pair spanning two blocks keeps that end', async () => {
		await walk(2, 'end'.length, 'lineEnd');
		await press(`${WORD_MODIFIER}+Backspace`);
		await expect.poll(() => line(2)).toBe('{<<b}end');
		await press('ControlOrMeta+z');
		await expect.poll(() => line(2)).toBe('blocks{<<b} end');
	});

	// Limits, as recorded: the join sees a pair's partner only in the blocks a range joins, and
	// inside one block it keeps a side whose partner it can't see.
	test('a selection across a lone side inside its block leaves the side', async () => {
		await walk(6, 'A lo'.length);
		await press('Shift+ArrowRight', 'ne si'.length);
		await press('Backspace');
		await expect.poll(source).toContain('\n\nA lo{<<x}ide\n');
	});

	test('a range from a paragraph into a table holding its partner leaves a lone side', async ({
		page
	}) => {
		await editor.loadContent('Para {>>p}one\n\n| a |\n| - |\n| cell{<<p} two |\n');
		await walk(0, 'Pa'.length);
		const box = (await page.locator('.table-cell').nth(1).boundingBox())!;
		await page.keyboard.down('Shift');
		await page.mouse.click(box.x + box.width - 6, box.y + box.height / 2);
		await page.keyboard.up('Shift');
		await press('Backspace');
		await expect.poll(source).toBe('Pa{>>p}\n');
	});

	test('a range taking the block holding a pair end whole takes that end', async () => {
		await walk(1, 0, 'lineEnd');
		await press('Shift+ArrowRight', 2);
		await press('Backspace');
		await expect.poll(source).not.toContain('{<<b}');
	});

	test('select-all then Delete in the block holding a pair end takes that end', async () => {
		await walk(2, 0);
		await press('ControlOrMeta+a');
		await press('Delete');
		await expect.poll(source).not.toContain('{<<b}');
	});

	test('a range over three blocks taking a whole pair leaves no side', async () => {
		await walk(1, 'Acr'.length);
		await press('Shift+ArrowRight', 'oss two'.length + 2);
		await press('Backspace');
		await expect.poll(() => line(1)).toBe('AcrSome {>>c}**bold**{<<c} text');
	});
});
