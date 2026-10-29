/**
 * What caret a user sees right now, read off the page: the browser's own caret in the focused
 * editable, and every caret the editor draws (the drawn caret's bar, at a text caret, beside a
 * widget or across a gap). Every row about the drawn caret asserts exactly one of them shows, and
 * the rows that need the browser's own painted caret find it red in a screenshot.
 */

import { expect, type Locator, type Page } from '@playwright/test';

export interface CaretsShowing {
	/** The focused editable holds a collapsed selection and paints the browser's caret. */
	native: boolean;
	/** Carets the editor paints itself. */
	drawn: number;
}

export function caretsShowing(page: Page): Promise<CaretsShowing> {
	return page.evaluate(() => {
		const active = document.activeElement as HTMLElement | null;
		const sel = window.getSelection();
		const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
		const collapsed = field
			? active.selectionStart === active.selectionEnd
			: !!active?.isContentEditable &&
				!!sel &&
				sel.rangeCount > 0 &&
				sel.isCollapsed &&
				active.contains(sel.anchorNode);
		const color = active ? getComputedStyle(active).caretColor : '';
		const native =
			document.hasFocus() && collapsed && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)';
		const drawn = [...document.querySelectorAll<HTMLElement>('.md-drawn-caret')].filter(
			(bar) => getComputedStyle(bar).display !== 'none'
		).length;
		return { native, drawn };
	});
}

/** A caret's box in client pixels. */
export interface CaretBox {
	left: number;
	top: number;
	height: number;
}

/** The drawn caret's bar, or null while it draws nothing. */
export function drawnCaretBox(page: Page): Promise<CaretBox | null> {
	return page.evaluate(() => {
		const bar = document.querySelector<HTMLElement>('.md-drawn-caret[data-caret-state="text"]');
		if (!bar) return null;
		const r = bar.getBoundingClientRect();
		return { left: r.left, top: r.top, height: r.height };
	});
}

/** The marks the drawn caret's look shows, outermost first, empty for the plain bar; null while it
 *  draws no text caret. */
export function drawnCaretMarks(page: Page): Promise<string[] | null> {
	return page.evaluate(() => {
		const bar = document.querySelector<HTMLElement>('.md-drawn-caret[data-caret-state="text"]');
		if (!bar || getComputedStyle(bar).display === 'none') return null;
		return bar.dataset.caretMarks?.split(' ').filter(Boolean) ?? [];
	});
}

/** The drawn caret's bar while it shows, in whichever state, with where it sits: the block host's
 *  path, or `gap` inside the gap caret's element. */
export interface DrawnBar {
	state: string;
	box: CaretBox & { width: number };
	host: string | null;
}

export function drawnBar(page: Page): Promise<DrawnBar | null> {
	return page.evaluate(() => {
		const bar = document.querySelector<HTMLElement>('.md-drawn-caret');
		if (!bar || getComputedStyle(bar).display === 'none') return null;
		const r = bar.getBoundingClientRect();
		const host = bar.parentElement?.closest('[data-gap-caret]')
			? 'gap'
			: (bar.closest('[data-block-path]')?.getAttribute('data-block-path') ?? null);
		return {
			state: bar.dataset.caretState ?? '',
			box: { left: r.left, top: r.top, height: r.height, width: r.width },
			host
		};
	});
}

/** The 1.5px bar a click put beside a widget: 1px past a text-height one, its full height; at a
 *  picture's edge, on its line (`caret/caret-shows.spec.ts` pins its height to the line's text). */
export async function expectBarBesideWidget(
	page: Page,
	widget: Locator,
	look: 'text-height' | 'image',
	side: 'before' | 'after' = 'after'
): Promise<void> {
	await expect.poll(async () => (await drawnBar(page))?.state).toBe('widget');
	const bar = (await drawnBar(page))!.box;
	const w = (await widget.boundingBox())!;
	// The bar's rows sit on whole device pixels, so its top and height round by up to a pixel.
	const close = (key: string, got: number, want: number, slack = 0.5) =>
		expect(Math.abs(got - want), `${key} ${got} vs ${want}`).toBeLessThanOrEqual(slack);
	close('width', bar.width, 1.5);
	if (look === 'image') {
		close('left', bar.left, side === 'after' ? w.x + w.width : w.x);
		const middle = bar.top + bar.height / 2;
		expect(middle, 'the bar sits on the picture’s line').toBeGreaterThan(w.y);
		expect(middle).toBeLessThan(w.y + w.height);
		return;
	}
	close('left', bar.left, side === 'after' ? w.x + w.width + 1 - 1.5 : w.x - 1);
	close('top', bar.top, w.y, 1);
	close('height', bar.height, w.height, 1);
}

/** The live collapsed range's box: its first rect with height, else the box of the node it sits
 *  against, the way a caret beside a line break or an empty block measures. */
export function nativeCaretBox(page: Page): Promise<CaretBox | null> {
	return page.evaluate(() => {
		const sel = window.getSelection();
		if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return null;
		const range = sel.getRangeAt(0);
		const rects = range.getClientRects();
		const own = rects.length > 0 && rects[0].height > 0 ? rects[0] : range.getBoundingClientRect();
		if (own.height > 0) return { left: own.left, top: own.top, height: own.height };
		const container = range.startContainer;
		if (container.nodeType !== Node.ELEMENT_NODE) return null;
		const boxOf = (node: Node | undefined, fromEnd: boolean) => {
			if (!node) return null;
			const around = document.createRange();
			around.selectNode(node);
			const all = around.getClientRects();
			const r =
				all.length === 0 ? around.getBoundingClientRect() : all[fromEnd ? all.length - 1 : 0];
			return r.height > 0
				? { left: fromEnd ? r.right : r.left, top: r.top, height: r.height }
				: null;
		};
		const kids = container.childNodes;
		return boxOf(kids[range.startOffset], false) ?? boxOf(kids[range.startOffset - 1], true);
	});
}

/** Sets the `caret` prop on the test route, live. */
export async function setCaretProp(page: Page, mode: 'auto' | 'native' | 'drawn'): Promise<void> {
	await page.evaluate((m) => (window as any).__test.setCaret(m), mode);
}

// ── The browser's own painted caret ─────────────────────────────────────────

export interface PaintedCaret {
	left: number;
	top: number;
	bottom: number;
}

/** The column and the span of the red caret the browser paints in `clip`, or null while it blinks
 *  off. */
async function paintedRedCaret(
	page: Page,
	clip: { x: number; y: number; width: number; height: number }
): Promise<PaintedCaret | null> {
	const shot = await page.screenshot({ clip, caret: 'initial' });
	return page.evaluate(
		async ({ b64, clip }) => {
			const img = new Image();
			img.src = `data:image/png;base64,${b64}`;
			await img.decode();
			const canvas = document.createElement('canvas');
			canvas.width = img.width;
			canvas.height = img.height;
			const ctx = canvas.getContext('2d')!;
			ctx.drawImage(img, 0, 0);
			const { data } = ctx.getImageData(0, 0, img.width, img.height);
			let left = Infinity;
			let top = Infinity;
			let bottom = -Infinity;
			for (let y = 0; y < img.height; y++) {
				for (let x = 0; x < img.width; x++) {
					const i = (y * img.width + x) * 4;
					if (data[i] > 200 && data[i + 1] < 60 && data[i + 2] < 60) {
						left = Math.min(left, x);
						top = Math.min(top, y);
						bottom = Math.max(bottom, y + 1);
					}
				}
			}
			if (left === Infinity) return null;
			return { left: clip.x + left, top: clip.y + top, bottom: clip.y + bottom };
		},
		{ b64: shot.toString('base64'), clip }
	);
}

/** Where the browser paints its own caret now, red and found by eye, retried past a blink. */
export async function browserCaret(page: Page): Promise<PaintedCaret> {
	await setCaretProp(page, 'native');
	await page.addStyleTag({
		content: '.editor [contenteditable] { caret-color: rgb(255, 0, 0) !important; }'
	});
	// On whole pixels, where the screenshot crops, so a found column offsets from the clip exactly;
	// cut to the viewport, since a long line's box runs far past what a caret can show in.
	const clip = await page.evaluate(() => {
		const r = (document.activeElement as HTMLElement).getBoundingClientRect();
		const x = Math.max(0, Math.floor(r.left) - 4);
		const y = Math.max(0, Math.floor(r.top) - 4);
		const right = Math.min(innerWidth, Math.ceil(r.right) + 4);
		const bottom = Math.min(innerHeight, Math.ceil(r.bottom) + 4);
		return { x, y, width: right - x, height: bottom - y };
	});
	let found: PaintedCaret | null = null;
	// A steady interval, so the samples can't fall into step with the blink.
	await expect
		.poll(async () => (found = await paintedRedCaret(page, clip)), {
			timeout: 5000,
			intervals: [100]
		})
		.not.toBeNull();
	return found!;
}

/** Exactly one caret shows; a drawn one sits on the line, and in the column, the browser paints
 *  its own caret at for the same selection. */
export async function oneCaretOnTheBrowsersLine(page: Page): Promise<'drawn' | 'native'> {
	// A key the browser handles moves the caret in a later task; its paint lands by the frame.
	await page.evaluate(
		() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
	);
	await expect
		.poll(async () => {
			const showing = await caretsShowing(page);
			return showing.drawn + (showing.native ? 1 : 0);
		})
		.toBe(1);
	const drawn = await drawnCaretBox(page);
	if (!drawn) return 'native';
	const painted = await browserCaret(page);
	// The same line: WebKit paints its own caret the full line box tall past a wrap, taller than
	// the text, so the drawn bar's middle is what has to fall inside it.
	const middle = drawn.top + drawn.height / 2;
	expect(middle, `line ${drawn.top} vs ${painted.top}..${painted.bottom}`).toBeGreaterThan(
		painted.top
	);
	expect(middle).toBeLessThan(painted.bottom);
	// WebKit measures the range in whole pixels, losing the fraction its own caret rounds; Chromium
	// floors its caret in the editable's own pixels, which are the screen's only on a whole-pixel x.
	const wholeX = await page.evaluate(() =>
		Number.isInteger((document.activeElement as HTMLElement).getBoundingClientRect().left)
	);
	const webkit = page.context().browser()?.browserType().name() === 'webkit';
	const slack = webkit || !wholeX ? 1 : 0;
	expect(
		Math.abs(Math.round(drawn.left) - painted.left),
		`x ${drawn.left} vs ${painted.left}`
	).toBeLessThanOrEqual(slack);
	return 'drawn';
}

// ── Under forced colors ─────────────────────────────────────────────────────

type Clip = { x: number; y: number; width: number; height: number };

/** Whether anything in `clip` blinks across a second of screenshots: a caret, of whoever's. */
async function blinksIn(page: Page, clip: Clip): Promise<boolean> {
	const shots: string[] = [];
	for (let i = 0; i < 6; i++) {
		shots.push((await page.screenshot({ clip, caret: 'initial' })).toString('base64'));
		await page.waitForTimeout(190);
	}
	return page.evaluate(async (all) => {
		const pixels = await Promise.all(
			all.map(async (b64) => {
				const img = new Image();
				img.src = `data:image/png;base64,${b64}`;
				await img.decode();
				const canvas = document.createElement('canvas');
				canvas.width = img.width;
				canvas.height = img.height;
				const ctx = canvas.getContext('2d')!;
				ctx.drawImage(img, 0, 0);
				return ctx.getImageData(0, 0, img.width, img.height).data;
			})
		);
		const [first, ...rest] = pixels;
		return rest.some((data) => data.some((v, i) => i % 4 !== 3 && Math.abs(v - first[i]) > 40));
	}, shots);
}

/** Carets showing in `clip` under forced colors, where the browser shows its own whatever
 *  `caret-color` says: the drawn bar, plus the browser's caret found blinking with the bar hidden. */
export async function caretsUnderForcedColors(page: Page, clip: Clip): Promise<number> {
	const drawn = (await drawnBar(page)) ? 1 : 0;
	const hide = await page.addStyleTag({ content: '.md-drawn-caret { display: none !important; }' });
	const native = (await blinksIn(page, clip)) ? 1 : 0;
	await hide.evaluate((style) => (style as HTMLStyleElement).remove());
	return drawn + native;
}
