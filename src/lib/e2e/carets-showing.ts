/**
 * What caret a user sees right now, read off the page: the browser's own caret in the focused
 * editable, and every caret the editor draws (the drawn caret's bar, or the snap caret beside a
 * widget). Every row about the drawn caret asserts exactly one of them shows, and the rows that
 * need the browser's own painted caret find it red in a screenshot.
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
		const bars = [...document.querySelectorAll<HTMLElement>('.md-drawn-caret')].filter(
			(bar) => bar.dataset.caretState === 'text' && getComputedStyle(bar).display !== 'none'
		).length;
		const snaps = document.querySelectorAll(
			'.md-snap-caret-active .md-snap-after, .md-snap-caret-active .md-snap-before'
		).length;
		return { native, drawn: bars + snaps };
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

/** The bar after a widget, where its click put the caret: 1.5px wide, its right side 1px past a
 *  text-height widget at the widget's full height, or 4px past an image and 4px short at each end. */
export async function expectBarAfterWidget(
	page: Page,
	widget: Locator,
	look: 'text-height' | 'image'
): Promise<void> {
	await expect.poll(async () => (await drawnBar(page))?.state).toBe('widget');
	const bar = (await drawnBar(page))!.box;
	const w = (await widget.boundingBox())!;
	const inset = look === 'image' ? 4 : 0;
	const past = look === 'image' ? 4 : 1;
	const want = {
		left: w.x + w.width + past - 1.5,
		top: w.y + inset,
		height: w.height - 2 * inset,
		width: 1.5
	};
	for (const key of ['left', 'top', 'height', 'width'] as const) {
		expect(Math.abs(bar[key] - want[key]), `${key} ${bar[key]} vs ${want[key]}`).toBeLessThan(0.5);
	}
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
	const block = await page.evaluate(() => {
		const r = (document.activeElement as HTMLElement).getBoundingClientRect();
		return { x: r.x, y: r.y, width: r.width, height: r.height };
	});
	const clip = { x: block.x - 4, y: block.y - 4, width: block.width + 8, height: block.height + 8 };
	let found: PaintedCaret | null = null;
	await expect
		.poll(async () => (found = await paintedRedCaret(page, clip)), { timeout: 5000 })
		.not.toBeNull();
	return found!;
}

/** Exactly one caret shows; a drawn one sits on the line, and at the x, the browser paints its
 *  own caret at for the same selection. */
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
	expect(
		Math.abs(drawn.left - painted.left),
		`x ${drawn.left} vs ${painted.left}`
	).toBeLessThanOrEqual(1);
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
	await hide.evaluate((style) => style.remove());
	return drawn + native;
}
