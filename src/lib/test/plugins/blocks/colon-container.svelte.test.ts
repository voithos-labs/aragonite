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
	type Block
} from '#lib/plugin.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { insertBy } from '#lib/test/harness/insertion-routes.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

type ColonData = { name: string };

const aside = container<ColonData>({
	name: 'aside',
	label: 'Aside',
	lines: colonLines({
		names: ['aside', 'margin'],
		title: { label: 'Heading', className: 'aside-heading' }
	}),
	sample: ':::aside T\nbody\n:::\n',
	insert: { none: 'a test block type' }
});
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
