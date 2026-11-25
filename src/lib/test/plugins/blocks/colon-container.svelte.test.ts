// @vitest-environment jsdom
// A `:::name` container a maker makes: listing it turns the directive grammar on (unlisted names read
// as generic boxes, `::leaf` and `:text[]` read too), its names stay its editor's, its data is the
// name alone and its title row is the shared opening line, named and classed by its type.
// Miss-analysis: `container()` refused colon lines, so every `:::` row ran on a `setup` plugin that
// turned directives on itself, and no row held a value that brings them.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	activateDirectives,
	colonLines,
	container,
	definePlugin,
	grammar,
	parseDirectiveAttributes,
	type Block,
	type CstNode
} from '#lib/plugin.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { deleteBy, insertBy } from '#lib/test/harness/insertion-routes.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

type ColonData = { name: string };
type Seam = { __test: { getDocument(): CstNode } };

const ASIDE = {
	name: 'aside',
	label: 'Aside',
	lines: colonLines({
		names: ['aside', 'margin'],
		title: { label: 'Heading', className: 'aside-heading' }
	}),
	sample: ':::aside T\nbody\n:::\n',
	insert: { none: 'a test block type' }
};
const aside = container<ColonData>(ASIDE);
const asides = definePlugin({
	name: 'asides',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({ blocks: [aside] })
});

const MIXED = ':::foo\nx\n:::\n\n::bar\n\na :baz[y] c\n\n:::aside T\nn\n:::\n';
const kinds = (blocks: readonly Block[]) => blocks.map((b) => b.type.name);

describe('an editor listing a colon type and nothing else', () => {
	it('reads every `:::` name, `::leaf` and `:text[]`, its own names as its type', async () => {
		expect(kinds(grammar([asides]).parse(MIXED).blocks)).toEqual([
			'directiveContainer',
			'directiveLeaf',
			'paragraph',
			'asides/aside'
		]);
		const m = mountEditor({ source: MIXED, plugins: [asides] });
		await m.settle();
		expect(kinds(m.instance.doc.blocks)).toEqual([
			'directiveContainer',
			'directiveLeaf',
			'paragraph',
			'asides/aside'
		]);
		expect(m.target.querySelector('.directive-text-widget')).not.toBeNull();
		expect(m.source()).toBe(MIXED);
	});

	it('leaves its names to it: an editor on the same page listing nothing reads them generic', async () => {
		const listing = mountEditor({ source: ':::aside T\nn\n:::\n', plugins: [asides] });
		const other = mountEditor({ source: ':::aside T\nn\n:::\n', plugins: [] });
		await listing.settle();
		await other.settle();
		expect(kinds(listing.instance.doc.blocks)).toEqual(['asides/aside']);
		expect(kinds(other.instance.doc.blocks)).toEqual(['directiveContainer']);
	});

	it('reads as before on a page that turned directives on itself', async () => {
		activateDirectives();
		const m = mountEditor({ source: MIXED, plugins: [] });
		await m.settle();
		expect(kinds(m.instance.doc.blocks)).toEqual([
			'directiveContainer',
			'directiveLeaf',
			'paragraph',
			'directiveContainer'
		]);
	});

	it('starts a title from a letter typed at its bare name’s end, the kind and name kept', async () => {
		const m = mountEditor({ source: ':::margin\nin\n:::\n', plugins: [asides] });
		await m.settle();
		placeCaret(surfaceAt(m, [0, 0]), ':::margin'.length);
		await insertBy('hardware key', document.activeElement as HTMLElement, 'H');
		await m.settle();
		expect(m.source()).toBe(':::margin H\nin\n:::\n');
		expect([kinds(m.instance.doc.blocks), m.instance.doc.blocks[0].data]).toEqual([
			['asides/aside'],
			{ name: 'margin' }
		]);
	});

	it('leaves out a later type that claims a name an earlier one holds, and says so', async () => {
		const errors: unknown[] = [];
		const twin = container<ColonData>({
			...ASIDE,
			name: 'twin',
			lines: colonLines({ names: ['margin'] })
		});
		const plugin = definePlugin({
			name: 'twins',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [container<ColonData>(ASIDE), twin] })
		});
		const m = mountEditor({
			source: ':::margin T\nbody\n:::\n',
			plugins: [plugin],
			onError: (e) => errors.push(e)
		});
		await m.settle();
		expect(kinds(m.instance.doc.blocks)).toEqual(['twins/aside']);
		expect(String((errors[0] as { cause?: unknown })?.cause)).toMatch(/:::margin/);
	});
});

describe('a colon type’s data and attributes', () => {
	it('holds the name alone; a key inside `{.a}` re-reads nothing and nothing goes stale', async () => {
		let attrs: string[] = [];
		const read = container<ColonData>({
			name: 'aside',
			label: 'Aside',
			lines: colonLines({ names: ['aside'] }),
			sample: ':::aside T\nbody\n:::\n',
			insert: { none: 'a test block type' },
			draw: (block, ctx) => {
				const see = (b: Block<ColonData>) => {
					attrs = parseDirectiveAttributes(b.title!.text).classes;
				};
				see(block);
				const dom = document.createElement('div');
				dom.append(ctx.children);
				return { dom, update: (b) => see(b) };
			}
		});
		const plugin = definePlugin({
			name: 'asides',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({ blocks: [read] })
		});
		const m = mountEditor({ source: ':::aside{.a} T\nbody\n:::\n', plugins: [plugin] });
		await m.settle();
		expect([m.instance.doc.blocks[0].data, attrs]).toEqual([{ name: 'aside' }, ['a']]);
		placeCaret(surfaceAt(m, [0, 0]), ':::aside{.a'.length);
		await insertBy('hardware key', document.activeElement as HTMLElement, 'b');
		await m.settle();
		expect(m.source()).toBe(':::aside{.ab} T\nbody\n:::\n');
		expect([m.instance.doc.blocks[0].data, attrs]).toEqual([{ name: 'aside' }, ['ab']]);
	});

	it('writes a new name alone through edit().data, as one undo step', async () => {
		const m = mountEditor({ source: ':::aside{.a} T\nbody\n:::\n', plugins: [asides] });
		await m.settle();
		const block = m.instance.doc.blocks[0] as Block<ColonData>;
		await m.instance.edit().data(block, { name: 'margin' }).commit();
		await m.settle();
		expect(m.source()).toBe(':::margin{.a} T\nbody\n:::\n');
		expect(m.instance.doc.blocks[0].data).toEqual({ name: 'margin' });
		m.instance.runCommand('history.undo');
		await m.settle();
		expect(m.source()).toBe(':::aside{.a} T\nbody\n:::\n');
	});

	it('refuses a name it doesn’t hold through edit().data, the bytes kept', async () => {
		const m = mountEditor({ source: ':::aside T\nbody\n:::\n', plugins: [asides] });
		await m.settle();
		const block = m.instance.doc.blocks[0] as Block<ColonData>;
		const result = await m.instance.edit().data(block, { name: 'foo' }).commit();
		await m.settle();
		expect(result).toMatchObject({ ok: false, reason: 'illegal' });
		expect(m.source()).toBe(':::aside T\nbody\n:::\n');
	});

	it('takes no fold yet, refused when the type is made', () => {
		const make = () =>
			container<ColonData>({
				name: 'spoiler',
				label: 'Spoiler',
				lines: colonLines({ names: ['spoiler', 'shown'] }),
				closable: {
					closed: (d) => d.name === 'spoiler',
					set: (d, closed) => ({ ...d, name: closed ? 'spoiler' : 'shown' })
				},
				sample: ':::spoiler T\nbody\n:::\n',
				insert: { none: 'a test block type' }
			});
		expect(make).toThrow(/closable needs a title row, for now fenced lines with a title/);
	});
});

describe('a colon type’s title row', () => {
	const wide = container<ColonData>({
		name: 'wide',
		label: 'Wide',
		lines: colonLines({
			names: ['asides'],
			title: { label: 'Wide heading', className: 'wide-heading' }
		}),
		sample: ':::asides T\nbody\n:::\n',
		insert: { none: 'a test block type' }
	});
	// A type belongs to the first plugin that lists it, so this one makes its own aside.
	const own = container<ColonData>({ ...ASIDE, name: 'aside' });
	const both = definePlugin({
		name: 'both',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [own, wide] })
	});
	const row = (m: ReturnType<typeof mountEditor>) => {
		const surface = surfaceAt(m, [0, 0]);
		return {
			kind: (m.instance as unknown as Seam).__test.getDocument().children![0].children![0].kind,
			name: surface.getAttribute('aria-label'),
			classed: [...surface.classList].filter((c) => /heading|directive-opener-line/.test(c))
		};
	};

	it('is the shared opening line, named and classed as its type declares', async () => {
		const m = mountEditor({ source: ':::aside T\nbody\n:::\n', plugins: [asides] });
		await m.settle();
		expect(row(m)).toEqual({
			kind: 'directiveOpenerLine',
			name: 'Heading',
			classed: ['directive-opener-line', 'aside-heading']
		});
	});

	it.each([
		['another colon type', 's', ':::asides', 'both/wide', 'Wide heading', 'wide-heading'],
		['a generic box', 'Backspace', ':::asid', 'directiveContainer', 'Title', undefined]
	])(
		'keeps its kind and the caret when a name edit makes %s, and takes its look',
		async (_, key, written, kind, name, className) => {
			const m = mountEditor({ source: ':::aside T\nbody\n:::\n', plugins: [both] });
			await m.settle();
			placeCaret(surfaceAt(m, [0, 0]), ':::aside'.length);
			const el = document.activeElement as HTMLElement;
			if (key === 'Backspace') await deleteBy(el, key);
			else await insertBy('hardware key', el, key);
			await m.settle();
			expect(m.source()).toBe(`${written} T\nbody\n:::\n`);
			expect(kinds(m.instance.doc.blocks)).toEqual([kind]);
			expect(m.instance.getSelection()).toMatchObject({
				focus: { path: [0, 0], offset: written.length }
			});
			expect(row(m)).toEqual({
				kind: 'directiveOpenerLine',
				name,
				classed: ['directive-opener-line', ...(className ? [className] : [])]
			});
		}
	);
});
