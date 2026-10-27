import { test, expect, RESIZE_OBSERVER_LOOP } from '../../fixtures';
import { type Page } from '@playwright/test';
import { EditorPage } from '../../editor-page';
import { gateFixturePhotos } from '../../page-probes';
import { textRunRect } from '../../text-runs';
import { waitForImagesDecoded } from '../blocks/image/helpers';
import { openFind, typeQuery } from '../search/helpers';

/**
 * Every route that scrolls to a block keeps it where it landed while the images above it load
 * and grow (requirements/decorations/scroll-to-block-growth.md). The photos wait behind a gate the
 * test opens mid-scroll or once the route has resolved.
 */

// A capped viewport makes the editor a real scroll container, so the target starts windowed out.
test.use({ viewport: { width: 1000, height: 700 } });

const TARGET = 'Target below the image band';
const PHOTO = '/test-fixtures/photos/photo-600x400.png';

interface Fixture {
	name: string;
	md: string;
	/** The target leaf's path, read off the parsed document. */
	targetPath(page: Page): Promise<number[]>;
	pageErrors?: string[];
}

// Room above the band leaves `'center'` its half viewport; each photo grows by about 400px.
const ROOM = 12;
const BAND = 20;
const BELOW = 90;

function rootBand(): Fixture {
	const parts = ['# Image band fixture', 'Intro prose at the top of the document.'];
	for (let i = 0; i < ROOM; i++) parts.push(`Room paragraph ${i} above the image band.`);
	for (let i = 0; i < BAND; i++) parts.push(`![band image ${i}](${PHOTO}?root=${i})`);
	const target = parts.length;
	parts.push(`## ${TARGET}`);
	for (let i = 0; i < BELOW; i++) parts.push(`Below paragraph ${i} with a full line of prose.`);
	return {
		name: 'the document',
		md: parts.join('\n\n') + '\n',
		targetPath: async () => [target]
	};
}

// A list windows its items through a loop of its own. A table cell shows image syntax as text, so
// nothing in a row grows by itself and a table gets no row here.
function listBand(): Fixture {
	const items: string[] = [];
	for (let i = 0; i < ROOM; i++) items.push(`- Room ${i} above the image band.`);
	for (let i = 0; i < BAND; i++) items.push(`- ![band image ${i}](${PHOTO}?list=${i})`);
	items.push(`- ${TARGET}`);
	for (let i = 0; i < BELOW; i++) items.push(`- Below ${i} with a full line of prose.`);
	return {
		name: 'a list',
		md: `# Image band in a list\n\n${items.join('\n')}\n`,
		targetPath: (page) =>
			page.evaluate((target) => {
				const items = (window as any).__test.getDocument().children[1].children as unknown[];
				// The item's paragraph.
				return [1, items.findIndex((c) => JSON.stringify(c).includes(target)), 0];
			}, TARGET),
		// The list's re-render lands inside the size report that moved its window, on the base tree
		// too; the fixture fails these rows the day that stops.
		pageErrors: [RESIZE_OBSERVER_LOOP]
	};
}

const FIXTURES = { root: rootBand(), list: listBand() };

interface Landing {
	inView: boolean;
	/** The target line's top below the editor viewport's top. */
	top: number;
	centerOffset: number;
	viewportHeight: number;
}

// Measured on the target's own painted text, by the test rather than the editor's visibility check.
async function landing(page: Page): Promise<Landing | null> {
	if ((await page.getByText(TARGET).count()) === 0) return null;
	const run = await textRunRect(page, TARGET);
	const er = await page.locator('.editor').evaluate((el) => {
		const r = el.getBoundingClientRect();
		return { top: r.top, bottom: r.bottom, height: r.height };
	});
	return {
		inView: run.top < er.bottom && run.bottom > er.top,
		top: run.top - er.top,
		centerOffset: run.top + run.height / 2 - (er.top + er.height / 2),
		viewportHeight: er.height
	};
}

interface Landed {
	/** The route's own answer, for a route that gives one. */
	resolved: boolean | null;
	/** Where the target sat the moment the route resolved. */
	at: Landing | null;
}

interface Route {
	name: string;
	centered?: boolean;
	/** Setup, run with the photos still held. */
	prepare?(editor: EditorPage, target: number[]): Promise<void>;
	/** `release` opens the photo gate mid-scroll, for a route whose photos were asked for in
	 *  `prepare`: a held request isn't made again, so it can't open the gate itself. */
	run(editor: EditorPage, target: number[], release: () => void): Promise<Landed>;
}

async function answered(editor: EditorPage, call: Promise<boolean>): Promise<Landed> {
	const resolved = await call;
	return { resolved, at: await landing(editor.page) };
}

// A gesture route has no promise to await: it has resolved once its target first shows.
async function firstInView(editor: EditorPage): Promise<Landed> {
	let at: Landing | null = null;
	await expect
		.poll(async () => {
			at = await landing(editor.page);
			return at?.inView;
		})
		.toBe(true);
	return { resolved: null, at };
}

function scrollTo(editor: EditorPage, path: number[], block: 'nearest' | 'center') {
	return editor.page.evaluate(
		({ path, block }) => (window as any).__test.rects.scrollTo(path, { block }) as Promise<boolean>,
		{ path, block }
	);
}

function navigateTo(editor: EditorPage, path: number[]): Promise<boolean> {
	return editor.page.evaluate((p) => (window as any).__test.rects.navigateTo(p, 0), path);
}

function caretBlock(page: Page): Promise<string | null> {
	return page.evaluate(() => {
		const node = window.getSelection()?.focusNode;
		const el = node instanceof Element ? node : node?.parentElement;
		return el?.closest('[data-block-path]')?.getAttribute('data-block-path') ?? null;
	});
}

const NEAREST: Route = {
	name: "scrollTo { block: 'nearest' }",
	run: (editor, path) => answered(editor, scrollTo(editor, path, 'nearest'))
};

const ROUTES: Route[] = [
	NEAREST,
	{
		name: "scrollTo { block: 'center' }",
		centered: true,
		run: (editor, path) => answered(editor, scrollTo(editor, path, 'center'))
	},
	{
		name: 'navigateTo, as a heading or footnote link lands',
		// A link is clicked inside the editor, so its caret has a focused editor to land in.
		prepare: (editor) => editor.clickBlock(0),
		run: (editor, path) => answered(editor, navigateTo(editor, path))
	},
	{
		name: 'search jumping to a match',
		prepare: openFind,
		async run(editor) {
			await typeQuery(editor, TARGET);
			return firstInView(editor);
		}
	},
	{
		name: 'undo landing its caret far away',
		async prepare(editor, path) {
			await editor.clickBlock(0);
			await navigateTo(editor, path);
			await expect.poll(() => caretBlock(editor.page)).toBe(JSON.stringify(path));
			await editor.page.keyboard.type('x');
			await editor.scrollEditorTo(0);
			await editor.clickBlock(0);
			await expect.poll(() => caretBlock(editor.page)).toBe('[0]');
		},
		async run(editor, _path, release) {
			await editor.page.keyboard.press('ControlOrMeta+z');
			release();
			return firstInView(editor);
		}
	}
];

const CASES: { route: Route; fixture: Fixture }[] = [
	...ROUTES.map((route) => ({ route, fixture: FIXTURES.root })),
	{ route: NEAREST, fixture: FIXTURES.list }
];

for (const { route, fixture } of CASES) {
	test.describe(`${route.name} in ${fixture.name}`, () => {
		if (fixture.pageErrors) test.use({ expectPageErrors: fixture.pageErrors });

		for (const midScroll of [true, false]) {
			const when = midScroll ? 'images load during the scroll' : 'images load after it resolves';
			test(`stays put when ${when}`, async ({ page }) => {
				const openGate = await gateFixturePhotos(page);
				const editor = new EditorPage(page);
				await editor.goto();
				await editor.loadContent(fixture.md);
				await editor.waitForRenderFlush();
				expect(await landing(page), 'the target starts windowed out').toBeNull();
				const path = await fixture.targetPath(page);
				await route.prepare?.(editor, path);

				// The first photo the scroll asks for opens the gate, so the rest load while it runs.
				let opened = false;
				const release = () => {
					opened = true;
					openGate();
				};
				if (midScroll) void page.waitForRequest(`**${PHOTO}**`).then(release, () => {});
				const { resolved, at } = await route.run(editor, path, midScroll ? release : () => {});
				if (midScroll) {
					expect(opened, 'the photos began loading before the route resolved').toBe(true);
				} else {
					// Mid-scroll, a read between a photo's growth and the frame's correction sees a page
					// no frame paints, so only a settled landing is a fair reference.
					expect(at?.inView, 'the route brought its target into view').toBe(true);
				}
				if (resolved !== null) expect(resolved).toBe(true);
				openGate();

				await waitForImagesDecoded(page.locator('.editor img'));
				await editor.waitForRenderFlush();
				await editor.waitForRenderFlush();
				const after = await landing(page);
				expect(after?.inView, 'still in view once every image above it has grown').toBe(true);
				if (route.centered) {
					expect(Math.abs(after!.centerOffset)).toBeLessThan(after!.viewportHeight * 0.3);
				}
				// Where it landed, give or take a sub-pixel snap: the growth moved the page, not it.
				if (!midScroll) expect(Math.abs(after!.top - at!.top)).toBeLessThanOrEqual(2);
			});
		}
	});
}

// The page lays a picture's new size out before the browser reports it. A jump in that gap reads
// the target off the grown page, and the tables must hear the growth first or count it twice.
const SAME_TASK: { name: string; prepare?(editor: EditorPage): Promise<void>; call: string }[] = [
	{ name: "scrollTo { block: 'nearest' }", call: 'scrollTo' },
	{ name: 'navigateTo', prepare: (editor) => editor.clickBlock(0), call: 'navigateTo' }
];

// The target block's top below the editor viewport's top, or null while it is windowed out.
function blockTop(page: Page, path: number[]): Promise<number | null> {
	return page.evaluate((path) => {
		const el = document.querySelector(`.editor [data-block-path="${JSON.stringify(path)}"]`);
		const editor = document.querySelector('.editor')!;
		return el ? el.getBoundingClientRect().top - editor.getBoundingClientRect().top : null;
	}, path);
}

for (const route of SAME_TASK) {
	test(`${route.name} stays put when a picture above grows just before it (#798)`, async ({
		page
	}) => {
		await gateFixturePhotos(page);
		const editor = new EditorPage(page);
		await editor.goto();
		await editor.loadContent(FIXTURES.root.md);
		await editor.waitForRenderFlush();
		const path = await FIXTURES.root.targetPath(page);
		await route.prepare?.(editor);
		expect(await scrollTo(editor, path, 'nearest')).toBe(true);
		await editor.waitForRenderFlush();

		// One task: the picture grows, the route runs and its landing is read, before any frame can
		// report the growth.
		const landed = await page.evaluate(
			async ({ path, call }) => {
				const t = (window as any).__test;
				const editorTop = () => document.querySelector('.editor')!.getBoundingClientRect().top;
				const target = () =>
					document.querySelector(`.editor [data-block-path="${JSON.stringify(path)}"]`)!;
				const pictures = [...document.querySelectorAll<HTMLImageElement>('.editor img')];
				const above = pictures.filter(
					(img) => img.getBoundingClientRect().bottom <= target().getBoundingClientRect().top
				);
				const picture = above[above.length - 1];
				picture.style.display = 'block';
				picture.style.height = '400px';
				const resolved: boolean = await (call === 'scrollTo'
					? t.rects.scrollTo(path)
					: t.rects.navigateTo(path, 0));
				return { resolved, top: target().getBoundingClientRect().top - editorTop() };
			},
			{ path, call: route.call }
		);
		expect(landed.resolved).toBe(true);

		await editor.waitForRenderFlush();
		await editor.waitForRenderFlush();
		const top = await blockTop(page, path);
		expect(top, 'still mounted once the growth is reported').not.toBeNull();
		expect(Math.abs(top! - landed.top)).toBeLessThanOrEqual(2);
	});
}
