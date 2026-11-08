// @vitest-environment jsdom
// A plugin's `container` read by the editors that run its plugin: its lines read through the shape's
// own line syntax, its children drawn where its drawing puts them, its bytes written by the editor.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { container } from '#lib/components/block-makers/container.js';
import { builtin } from '#lib/components/block-makers/builtin.js';
import { registerBlockKind } from '#lib/schema/block-kind-descriptor.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { textBlockView } from '#lib/components/blocks/text/text-block-view.js';
import type { ContainerSpec } from '#lib/schema/container-block.js';
import type { ContainerDrawContext } from '#lib/schema/drawing.js';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

/** A plugin with one container type. */
function boxes<D>(spec: Partial<ContainerSpec<D>> & Pick<ContainerSpec<D>, 'lines'>) {
	return definePlugin({
		name: 'boxes',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [container<D>({ name: 'box', label: 'Box', sample: '%> x', ...spec })]
		})
	});
}

const MARKED = { shape: 'marked', first: '%> ', rest: '%> ', reads: /^%> ?/, lazy: true } as const;

const NOTE_LINES = {
	shape: 'indented',
	open: /^\[\^(\w+)\]: ?/,
	data: (match: RegExpExecArray) => ({ label: match[1] }),
	first: (data: { label: string }) => `[^${data.label}]: `,
	rest: () => '    ',
	lazy: true
} as const;

type Mounted = ReturnType<typeof mountEditor>;

const kinds = (m: Mounted, paths: number[][]) =>
	paths.map((path) => m.instance.getBlockKindAt(path));
const rawAt = (m: Mounted, i: number) =>
	(m.instance.__test as { getDocument(): { children: { raw: string }[] } }).getDocument().children[
		i
	].raw;

describe('a marked container', () => {
	it('holds the blocks its lines hold, a lazy line among them, and ends at a blank line', async () => {
		const source = '%> # Title\n%> some text\nlazy\n\nafter\n';
		const m = mountEditor({ source, plugins: [boxes({ lines: MARKED })] });
		await m.settle();
		expect(kinds(m, [[0], [0, 0], [0, 1], [1]])).toEqual([
			'boxes/box',
			'heading',
			'paragraph',
			'paragraph'
		]);
		expect(rawAt(m, 0)).toBe('%> # Title\n%> some text\nlazy\n');
		expect(m.instance.getSource()).toBe(source);
	});

	it('takes Enter in a child as a new child, a marked blank line between the two', async () => {
		const m = mountEditor({ source: '%> one\n', plugins: [boxes({ lines: MARKED })] });
		await m.settle();
		await pressKeyAt(m, [0, 0], 3, { key: 'Enter' });
		await m.settle();
		expect(m.instance.getSource()).toBe('%> one\n%>\n%>\n');
		expect(kinds(m, [[0, 1]])).toEqual(['paragraph']);
	});

	it('is a paragraph in an editor that does not run its plugin', async () => {
		const m = mountEditor({ source: '%> text\n', plugins: [] });
		await m.settle();
		expect(kinds(m, [[0]])).toEqual(['paragraph']);
	});

	it('draws its children where its drawing puts them, and a child edit writes its markers', async () => {
		const draw = (_block: unknown, ctx: ContainerDrawContext) => {
			const dom = document.createElement('aside');
			dom.className = 'drawn-box';
			dom.append(ctx.children);
			return { dom };
		};
		const m = mountEditor({ source: '%> one\n', plugins: [boxes({ lines: MARKED, draw })] });
		await m.settle();
		expect(
			blockHostAt(m, [0]).querySelector('.drawn-box [data-block-path="[0,0]"]')
		).not.toBeNull();
		typeInto(surfaceAt(m, [0, 0]), 'one two');
		await m.settle();
		expect(m.instance.getSource()).toBe('%> one two\n');
	});

	it('under a head line reads its data there and keeps the head as spelled', async () => {
		const lines = {
			...MARKED,
			head: {
				match: /^\[!(\w+)\]$/,
				data: (match: RegExpExecArray) => ({ type: match[1] }),
				write: (data: { type: string }) => `[!${data.type}]`
			}
		};
		const plugin = definePlugin({
			name: 'boxes',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [container({ name: 'alert', label: 'Alert', sample: '%> [!NOTE]\n%> x', lines })]
			})
		});
		const m = mountEditor({ source: '%> [!NOTE]\n%> one\n', plugins: [plugin] });
		await m.settle();
		expect(kinds(m, [[0], [0, 0]])).toEqual(['boxes/alert', 'paragraph']);
		typeInto(surfaceAt(m, [0, 0]), 'one two');
		await m.settle();
		expect(m.instance.getSource()).toBe('%> [!NOTE]\n%> one two\n');
	});

	it('is tried before the type it names in `before`', async () => {
		const quoteLike = { ...MARKED, first: '> ', rest: '> ', reads: /^ {0,3}> ?/ };
		const m = mountEditor({
			source: '> text\n',
			plugins: [boxes({ lines: quoteLike, before: builtin.blocks.blockquote })]
		});
		await m.settle();
		expect(kinds(m, [[0]])).toEqual(['boxes/box']);
	});
});

describe('an indented container', () => {
	it('reads its data from the first line and takes a blank line only when an indented one follows', async () => {
		const source = '[^a]: first\n\n    second\n\nafter\n';
		const m = mountEditor({ source, plugins: [boxes({ lines: NOTE_LINES })] });
		await m.settle();
		expect(kinds(m, [[0], [0, 0], [0, 1], [1]])).toEqual([
			'boxes/box',
			'paragraph',
			'paragraph',
			'paragraph'
		]);
		expect(rawAt(m, 0)).toBe('[^a]: first\n\n    second\n');
		expect(m.instance.getSource()).toBe(source);
	});

	it('shows its marker ahead of its first child, and writes it back after an edit', async () => {
		const m = mountEditor({ source: '[^a]: first\n', plugins: [boxes({ lines: NOTE_LINES })] });
		await m.settle();
		expect(blockHostAt(m, [0]).textContent).toContain('[^a]: ');
		typeInto(surfaceAt(m, [0, 0]), 'first word');
		await m.settle();
		expect(m.instance.getSource()).toBe('[^a]: first word\n');
	});
});

describe("a marked line shape's `reads`", () => {
	it('that stops short of a marker it writes throws where the type registers', () => {
		const kind = declarePluginKind('shortreads');
		expect(() =>
			registerBlockKind(kind, {
				view: textBlockView(),
				label: 'Short',
				editable: true,
				supportsInline: false,
				gapEdges: 'none',
				mergeRole: 'container',
				container: { lines: { ...MARKED, reads: /^%>/ } }
			})
		).toThrow(/must read the marker "%> " whole/);
	});
});
