import { test, expect } from '../../fixtures';
import { EditorPage } from '../../editor-page';
import { FIXTURE_BYTES } from '../perf/vr-helpers';
import { pointAtRaw } from '../../text-runs';
import { clickInPlace } from '../../click-in-place';

/**
 * `editor.view` in a browser (requirements/plugins/view.md): the byte under a point, a range's
 * boxes, `reveal`, and an overlay through scrolls, windowing and typing.
 */

type Box = { top: number; left: number; bottom: number; width: number; height: number } | null;

const view = <T>(page: EditorPage['page'], call: string, ...args: unknown[]) =>
	page.evaluate(({ call, args }) => (window as any).__test.view[call](...args) as T, {
		call,
		args
	});

const overlayBox = (page: EditorPage['page']): Promise<Box> =>
	page.evaluate(() => {
		const el = document.querySelector<HTMLElement>('[data-testid="view-overlay"]');
		if (!el || el.style.visibility === 'hidden') return null;
		const r = el.getBoundingClientRect();
		return { top: r.top, left: r.left, bottom: r.bottom, width: r.width, height: r.height };
	});

test.describe('editor.view', () => {
	let editor: EditorPage;

	test.beforeEach(async ({ page }) => {
		editor = new EditorPage(page);
		await editor.goto();
	});

	test('posAt at the caret box answers the caret byte, moving nothing', async ({ page }) => {
		await editor.loadContent('first line\n\nsecond line here\n');
		const point = await pointAtRaw(page, [1], 7);
		await page.mouse.click(point.x, point.y);
		await editor.waitForRenderFlush();
		const head = await view<number>(page, 'head');
		expect(head).toBe('first line\n\n'.length + 7);

		const box = (await view<Box>(page, 'caretBox'))!;
		await page.evaluate(() => (window as any).__test.startSelectionChangeCapture());
		const at = await view<number | null>(page, 'posAt', box.left, box.top + box.height / 2);
		await editor.waitForRenderFlush();
		const announced = await page.evaluate(() =>
			(window as any).__test.stopSelectionChangeCapture()
		);
		expect([at, await view<number>(page, 'head'), announced]).toEqual([head, head, []]);
	});

	test('boxesOf a range across blocks has a box on each line of text', async ({ page }) => {
		const source = 'lead para\n\n- one\n- two\n\nlast para\n';
		await editor.loadContent(source);
		const boxes = await view<Box[]>(page, 'boxesOf', 0, source.length);
		const lines = await page.evaluate(() =>
			[...document.querySelectorAll('.editor [data-block-path]')]
				.filter(
					(el) =>
						/para|one|two/.test(el.textContent ?? '') && !el.querySelector('[data-block-path]')
				)
				.map((el) => el.getBoundingClientRect().top)
		);
		const drawn = boxes.filter((b) => b!.width > 0);
		expect(lines).toHaveLength(4);
		for (const top of lines) expect(drawn.some((b) => Math.abs(b!.top - top) < 24)).toBe(true);
	});

	test('reveal brings a windowed-out byte on screen, centred or at the top', async ({ page }) => {
		const count = await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);
		const mid = Math.floor(count / 2);
		const sel = `[data-block-path='${JSON.stringify([mid])}']`;
		await expect(page.locator(sel)).toHaveCount(0);
		const byte = await page.evaluate((i) => {
			const doc = (window as any).__test.getDocument();
			let at = doc.prefix.length;
			for (let k = 0; k < i; k++)
				at += doc.children[k].leadingTrivia.length + doc.children[k].raw.length;
			return at + doc.children[i].leadingTrivia.length + 1;
		}, mid);

		const place = async (align: 'center' | 'start') => {
			expect(await view<boolean>(page, 'reveal', byte, align)).toBe(true);
			await editor.waitForRenderFlush();
			return page.evaluate((s) => {
				const root = document.querySelector('.editor')!.getBoundingClientRect();
				const block = document.querySelector(s)!.getBoundingClientRect();
				return {
					fromTop: block.top - root.top,
					fromMiddle: block.top + block.height / 2 - (root.top + root.height / 2)
				};
			}, sel);
		};
		expect(Math.abs((await place('center')).fromMiddle)).toBeLessThan(40);
		expect(Math.abs((await place('start')).fromTop)).toBeLessThan(40);
	});

	test('a held block reveals until a key is typed inside it, and its overlay comes off', async ({
		page
	}) => {
		await editor.loadContent('first\n\nsecond\n\nthird\n');
		await view(page, 'hold', 1);
		await view(page, 'overlay', null);
		expect(await view<boolean>(page, 'reveal', null)).toBe(true);
		await expect(page.getByTestId('view-overlay')).toHaveCount(1);

		await editor.focusBlockEnd(1);
		await page.keyboard.type('X');
		await editor.bridge.waitForSourceEquals('first\n\nsecondX\n\nthird\n');
		await editor.waitForRenderFlush();
		expect(await view<boolean>(page, 'reveal', null)).toBe(false);
		await expect(page.getByTestId('view-overlay')).toHaveCount(0);
		await view(page, 'hold', 1);
		expect(await view<boolean>(page, 'reveal', null)).toBe(true);
	});

	test('an overlay follows its block through a scroll and back from windowing', async ({
		page
	}) => {
		await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);
		await view(page, 'hold', 3);
		await view(page, 'overlay', null, '<span>pinned over block three</span>');
		const offset = async () => {
			const [pinned, block] = [await overlayBox(page), await view<Box>(page, 'boxOf')];
			return pinned && block && { dy: pinned.top - block.top, dx: pinned.left - block.left };
		};
		expect(await offset()).toEqual({ dy: 0, dx: 0 });
		// Its own width, one line long, not squeezed to its longest word.
		expect((await overlayBox(page))!.width).toBeGreaterThan(100);

		const root = (await page.locator('.editor').boundingBox())!;
		await page.mouse.move(root.x + root.width / 2, root.y + root.height / 2);
		await page.mouse.wheel(0, 120);
		await editor.waitForRenderFlush();
		const moved = await offset();
		expect(moved!.dy).toBeCloseTo(0, 0);
		expect(moved!.dx).toBeCloseTo(0, 0);

		await editor.scrollEditorTo(200_000);
		await editor.waitForRenderFlush();
		await expect.poll(() => overlayBox(page)).toBeNull();
		await editor.scrollEditorTo(0);
		await editor.waitForRenderFlush();
		await expect.poll(offset).toEqual({ dy: 0, dx: 0 });
	});

	test('an overlay follows its block when the blocks above change size with no write', async ({
		page
	}) => {
		await editor.loadLargeFixture('flat-prose', FIXTURE_BYTES);
		await view(page, 'hold', 3);
		await view(page, 'overlay', null, '<span>pinned over block three</span>');
		const drift = async () => {
			const [pinned, block] = [await overlayBox(page), await view<Box>(page, 'boxOf')];
			return pinned && block && Math.round(pinned.top - block.top);
		};
		expect(await drift()).toBe(0);
		// Taller by style alone, as a picture is once it loads: no node mounted, no key, no scroll.
		await page.evaluate(() => {
			const first = document.querySelector<HTMLElement>('.editor [data-block-path]')!;
			first.style.paddingBottom = '120px';
		});
		await expect.poll(drift).toBe(0);
		// Narrower with the window as it was, as a host's side panel makes it: the text wraps anew.
		await page.evaluate(() => {
			document.querySelector<HTMLElement>('.editor')!.style.width = '420px';
		});
		await expect.poll(drift).toBe(0);
	});

	test('typing in an input inside an overlay leaves the document alone', async ({ page }) => {
		await editor.loadContent('first\n\nsecond\n');
		await editor.focusBlockEnd(1);
		await page.keyboard.type('!');
		const source = 'first\n\nsecond!\n';
		await editor.bridge.waitForSourceEquals(source);
		await view(page, 'hold', 0);
		await view(page, 'overlay', null, '<span>note</span> <input data-testid="overlay-input" />');
		// A right-click there keeps the browser's own menu, as on the host's header.
		await page.evaluate(() =>
			window.addEventListener('contextmenu', (e) => ((window as any).__menu = e.defaultPrevented), {
				once: true
			})
		);
		await clickInPlace(page.getByTestId('view-overlay').getByText('note'), { button: 'right' });
		expect(await page.evaluate(() => (window as any).__menu)).toBe(false);
		const input = page.getByTestId('overlay-input');
		await clickInPlace(input);
		await page.keyboard.type('abc');
		await page.keyboard.press('Backspace');
		await page.keyboard.press('Enter');
		await expect(input).toHaveValue('ab');
		// Undo is the input's own there, not the document's.
		await page.keyboard.press('ControlOrMeta+z');
		await editor.waitForRenderFlush();
		expect(await editor.bridge.getSource()).toBe(source);
	});
});
