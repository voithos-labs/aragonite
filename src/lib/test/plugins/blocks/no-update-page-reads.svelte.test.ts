// @vitest-environment jsdom
// What a key typed in a drawn block reads off the page when its drawing has no `update`: no scroll
// position, and the same boxes however many blocks sit above it, since nothing redraws.
// Miss-analysis: no row counted a key's page reads in a drawn block, so the draw host kept the scroll
// around an update that wasn't there, reading every mounted block's box twice a key.
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { colonLines, container, definePlugin, lineBlock } from '#lib/plugin.js';
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

const undrawn = container<{ name: string }>({
	name: 'undrawn',
	label: 'Undrawn',
	lines: colonLines({ names: ['undrawn'] }),
	sample: ':::undrawn\nbody\n:::\n',
	insert: { none: 'a test block type' }
});
const framed = container<{ name: string }>({
	name: 'framed',
	label: 'Framed',
	lines: colonLines({ names: ['framed'] }),
	sample: ':::framed\nbody\n:::\n',
	insert: { none: 'a test block type' },
	draw: (_block, ctx) => {
		const dom = document.createElement('div');
		dom.append(ctx.children);
		return { dom };
	}
});
const marked = lineBlock({
	name: 'marked',
	label: 'Marked',
	match: /^@@ (?<text>.*)$/,
	sample: '@@ marked',
	insert: { none: 'a test block type' },
	edit: 'text',
	draw: (_block, ctx) => {
		const dom = document.createElement('div');
		dom.append(ctx.source);
		return { dom };
	}
});
const plugin = definePlugin({
	name: 'unheard',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ blocks: [undrawn, framed, marked] })
});

/** The boxes and scroll positions two letters read, typed mid-text in `source`'s first block below
 *  `above` paragraphs. */
async function readsOfTwoKeys(above: number, source: string, inBlock: number[]) {
	const m = mountEditor({ source: 'para\n\n'.repeat(above) + source, plugins: [plugin] });
	await m.settle();
	const el = surfaceAt(m, [above, ...inBlock]);
	placeCaret(el, 5);
	await m.settle();
	// Not counted: a container's first edit reads the scroll once, drawn or not.
	typeInto(el, el.textContent!.slice(0, 5) + 'w' + el.textContent!.slice(5));
	await m.settle();
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
		typeInto(el, el.textContent!.slice(0, 5) + letter + el.textContent!.slice(5));
		await m.settle();
	}
	vi.restoreAllMocks();
	expect(m.source()).toContain('yxw');
	await destroyMountedEditors();
	return reads;
}

it.each([
	['a container with no draw', ':::undrawn\ntarget text\n:::\n', [1]],
	['a container drawn with no update', ':::framed\ntarget text\n:::\n', [1]],
	['a text line drawn with no update', '@@ target text\n', []]
])(
	'a key in %s reads no scroll position and no box of a block above',
	async (_, source, inBlock) => {
		const few = await readsOfTwoKeys(2, source, inBlock);
		expect(await readsOfTwoKeys(30, source, inBlock)).toEqual({ boxes: few.boxes, scrollTops: 0 });
	}
);
