// @vitest-environment jsdom
// What a key typed in a drawn block reads off the page: no scroll position, and the same boxes
// however many blocks sit above it, whether the drawing has an `update` or not.
// Miss-analysis: no row counted a key's page reads in a drawn block, so the draw host kept the scroll
// around every update, reading every mounted block's box twice a key.
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import {
	colonLines,
	container,
	definePlugin,
	fencedBlock,
	lineBlock,
	type ContainerDrawContext,
	type TextDrawContext
} from '#lib/plugin.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(async () => {
	await destroyMountedEditors();
	vi.restoreAllMocks();
});

let updates = 0;
const counted = () => void updates++;

function holding(ctx: ContainerDrawContext) {
	const dom = document.createElement('div');
	dom.append(ctx.children);
	return dom;
}

function placing(ctx: TextDrawContext) {
	const dom = document.createElement('div');
	dom.append(ctx.source);
	return dom;
}

const marked = (name: string, marker: string) => ({
	name,
	label: name,
	match: new RegExp(`^${marker} (?<text>.*)$`),
	sample: `${marker} x`,
	insert: { none: 'a test block type' } as const,
	edit: 'text' as const
});

const plugin = definePlugin({
	name: 'reads',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			container<{ name: string }>({
				name: 'undrawn',
				label: 'Undrawn',
				lines: colonLines({ names: ['undrawn'] }),
				sample: ':::undrawn\nbody\n:::\n',
				insert: { none: 'a test block type' }
			}),
			container<{ name: string }>({
				name: 'framed',
				label: 'Framed',
				lines: colonLines({ names: ['framed'] }),
				sample: ':::framed\nbody\n:::\n',
				insert: { none: 'a test block type' },
				draw: (_block, ctx) => ({ dom: holding(ctx) })
			}),
			container<{ name: string }>({
				name: 'told',
				label: 'Told',
				lines: colonLines({ names: ['told'] }),
				sample: ':::told\nbody\n:::\n',
				insert: { none: 'a test block type' },
				draw: (_block, ctx) => ({ dom: holding(ctx), update: counted })
			}),
			lineBlock({ ...marked('marked', '@@'), draw: (_block, ctx) => ({ dom: placing(ctx) }) }),
			lineBlock({
				...marked('noted', '@!'),
				draw: (_block, ctx) => ({ dom: placing(ctx), update: counted })
			}),
			fencedBlock({
				name: 'opened',
				label: 'Opened',
				fence: { open: /^%%%$/, close: '%%%' },
				sample: '%%%\nx\n%%%',
				insert: { none: 'a test block type' },
				edit: 'source',
				draw: (_block, ctx) => ({ dom: placing(ctx), update: counted })
			})
		]
	})
});

type Seam = { __test: { getBlockComponent(path: number[]): { focus(at: number): void } } };

/** The boxes and scroll positions two letters read, typed mid-text in `source`'s first block below
 *  `above` paragraphs, and the drawing's updates they brought. */
async function readsOfTwoKeys(above: number, source: string, inBlock: number[], at: number) {
	const m = mountEditor({ source: 'para\n\n'.repeat(above) + source, plugins: [plugin] });
	await m.settle();
	const path = [above, ...inBlock];
	// A block that opens its text gets the caret through the block, as a click on it does.
	(m.instance as unknown as Seam).__test.getBlockComponent(path).focus(at);
	await m.settle();
	const el = surfaceAt(m, path);
	placeCaret(el, at);
	await m.settle();
	const typeAt = (letter: string) =>
		typeInto(el, el.textContent!.slice(0, at) + letter + el.textContent!.slice(at));
	// Not counted: a container's first edit reads the scroll once, drawn or not.
	typeAt('w');
	await m.settle();
	updates = 0;
	const reads = { boxes: 0, scrollTops: 0 };
	const box = Element.prototype.getBoundingClientRect;
	vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
		reads.boxes++;
		return box.call(this);
	});
	const scrollTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
	vi.spyOn(Element.prototype, 'scrollTop', 'get').mockImplementation(function (this: Element) {
		reads.scrollTops++;
		return scrollTop.get!.call(this);
	});
	for (const letter of 'xy') {
		typeAt(letter);
		await m.settle();
	}
	vi.restoreAllMocks();
	expect(el.textContent).toContain('yxw');
	await destroyMountedEditors();
	return { ...reads, updates };
}

it.each([
	['a container with no draw', ':::undrawn\ntarget text\n:::\n', [1], 5, 0],
	['a container drawn with no update', ':::framed\ntarget text\n:::\n', [1], 5, 0],
	['a text line drawn with no update', '@@ target text\n', [], 5, 0],
	['a container whose drawing updates', ':::told\ntarget text\n:::\n', [1], 5, 2],
	['a text line whose drawing updates', '@! target text\n', [], 5, 2],
	['an opened source whose drawing updates', '%%%\ntarget text\n%%%\n', [], 9, 2]
])(
	'a key in %s reads no scroll position and no box of a block above',
	async (_, source, inBlock, at, told) => {
		const few = await readsOfTwoKeys(2, source, inBlock, at);
		expect(few.updates).toBe(told);
		expect(await readsOfTwoKeys(30, source, inBlock, at)).toEqual({
			boxes: few.boxes,
			scrollTops: 0,
			updates: told
		});
	}
);
