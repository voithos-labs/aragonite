// @vitest-environment jsdom
// A container on fenced lines, read and written by the editors that run its plugin: the opening and
// closing lines pair by depth past a code fence, an opener reads only as it's written, a body line
// that would open or close it is escaped, and the editor writes every line from the data and title.
// Miss-analysis: the one fenced container was a package's own opener and escape, so no row read a
// fenced shape the editor reads for itself.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { getPluginMetadata, type CstNode } from '#lib/core/nodes.js';
import { listGrammar } from '#lib/schema/own-syntax.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	pressKeyAt,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { insertBy, pressHardwareKey } from '#lib/test/harness/insertion-routes.js';
import type { Block } from '#lib/schema/doc-view.js';
import { folds, FOLD_SAMPLE, type FoldData } from '#lib/test/support/fold-fixture.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const FOLD = 'folds/fold';
const OPEN = FOLD_SAMPLE.replace('[fold]', '[fold open]');

function read(source: string) {
	const { grammar } = listGrammar([folds], ({ cause }) => {
		throw cause;
	});
	return parse(source, { grammar });
}

/** A block's kind and its children's, a title row as `row:<title>`. */
function shape(node: CstNode): unknown {
	if (node.kind !== FOLD) return node.kind;
	const [row, ...body] = node.children ?? [];
	return { row: row.raw, data: getPluginMetadata(node), body: body.map(shape) };
}

describe('a fenced container read', () => {
	it.each([
		['the sample', FOLD_SAMPLE, [{ row: 'T\n', data: { open: false }, body: ['paragraph'] }]],
		[
			'an open one with no blank lines',
			'[fold open]\ntitle: T\nbody\n[/fold]\n',
			[{ row: 'T\n', data: { open: true }, body: ['paragraph'] }]
		],
		[
			'a closer inside a code fence, which is code',
			'[fold]\ntitle: T\n\n```\n[/fold]\n```\n\n[/fold]\n',
			[{ row: 'T\n', data: { open: false }, body: ['fencedCode'] }]
		],
		[
			'a nested pair',
			'[fold]\ntitle: O\n\n[fold]\ntitle: I\n\nA\n\n[/fold]\n\n[/fold]\n',
			[
				{
					row: 'O\n',
					data: { open: false },
					body: [{ row: 'I\n', data: { open: false }, body: ['paragraph'] }]
				}
			]
		],
		[
			'an indented closer, which closes it',
			'[fold]\ntitle: T\n\nbody\n [/fold]\nmore\n[/fold]\n',
			[{ row: 'T\n', data: { open: false }, body: ['paragraph'] }, 'paragraph']
		],
		[
			'an opener in another spelling, which counts toward the depth',
			'[fold]\ntitle: T\n\n[FOLD]\nx\n[/fold]\n[/fold]\n',
			[{ row: 'T\n', data: { open: false }, body: ['paragraph'] }]
		],
		[
			'an opener in another spelling, which opens nothing',
			'[FOLD]\ntitle: T\n\nx\n\n[/fold]\n',
			['paragraph', 'paragraph', 'paragraph']
		],
		['no title line', '[fold]\nbody\n[/fold]\n', ['paragraph']],
		['no closing line', '[fold]\ntitle: T\nbody\n', ['paragraph']],
		[
			'a paragraph it interrupts',
			'para\n[fold]\ntitle: T\n\nx\n\n[/fold]\n',
			['paragraph', { row: 'T\n', data: { open: false }, body: ['paragraph'] }]
		],
		[
			'CRLF lines',
			'[fold]\r\ntitle: T\r\n\r\nbody\r\n\r\n[/fold]\r\n',
			[{ row: 'T\n', data: { open: false }, body: ['paragraph'] }]
		],
		[
			'a last closer with no line ending',
			'[fold]\ntitle: T\n\nbody\n\n[/fold]',
			[{ row: 'T\n', data: { open: false }, body: ['paragraph'] }]
		]
	])('%s', (_name, source, blocks) => {
		const doc = read(source);
		expect(doc.children.map(shape)).toEqual(blocks);
		expect(serialize(doc)).toBe(source);
	});
});

async function mounted(source: string) {
	const m = mountEditor({ source, plugins: [folds] });
	await m.settle();
	return m;
}

async function typeAt(
	m: Awaited<ReturnType<typeof mounted>>,
	path: number[],
	at: number,
	text: string
) {
	const el = surfaceAt(m, path);
	placeCaret(el, at);
	await insertBy('hardware key', el, text);
	await m.settle();
}

async function enterAt(m: Awaited<ReturnType<typeof mounted>>, path: number[], at: number) {
	await pressKeyAt(m, path, at, { key: 'Enter' });
	await m.settle();
}

describe('a fenced container written', () => {
	it('writes its lines around a body edit', async () => {
		const m = await mounted(OPEN);
		await typeAt(m, [0, 1], 4, '!');
		expect(m.source()).toBe('[fold open]\ntitle: T\n\nbody!\n\n[/fold]\n');
	});

	it('writes its title line around a title edit', async () => {
		const m = await mounted(FOLD_SAMPLE);
		await typeAt(m, [0, 0], 1, 'x');
		expect(m.source()).toBe('[fold]\ntitle: Tx\n\nbody\n\n[/fold]\n');
	});

	it.each([
		['a closing line', '[/fold]', '\\[/fold]'],
		['an opening line', '[fold]', '\\[fold]'],
		['a closing line in another spelling', '[/FOLD]', '\\[/FOLD]']
	])('escapes %s typed into the body, and stays one block', async (_name, typed, written) => {
		const m = await mounted(OPEN);
		await enterAt(m, [0, 1], 4);
		await typeAt(m, [0, 2], 0, typed);
		expect(m.source()).toBe(`[fold open]\ntitle: T\n\nbody\n\n${written}\n[/fold]\n`);
		expect(m.instance.getBlockKindAt([0])).toBe(FOLD);
		expect(m.instance.getBlockKindAt([1])).toBeNull();
	});

	it('keeps the caret after an escape where the typing left it', async () => {
		const m = await mounted(OPEN);
		await enterAt(m, [0, 1], 4);
		await typeAt(m, [0, 2], 0, '[/fold]');
		await pressHardwareKey(surfaceAt(m, [0, 2]), { key: 'x' });
		await m.settle();
		expect(m.source()).toBe('[fold open]\ntitle: T\n\nbody\n\n\\[/fold]x\n[/fold]\n');
	});

	it('keeps CRLF on every line it writes', async () => {
		const m = await mounted('[fold open]\r\ntitle: T\r\n\r\nbody\r\n\r\n[/fold]\r\n');
		await typeAt(m, [0, 1], 4, '!');
		expect(m.source()).toBe('[fold open]\r\ntitle: T\r\n\r\nbody!\r\n\r\n[/fold]\r\n');
	});

	it('keeps a last closer with no line ending without one', async () => {
		const m = await mounted('[fold open]\ntitle: T\n\nbody\n\n[/fold]');
		await typeAt(m, [0, 1], 4, '!');
		expect(m.source()).toBe('[fold open]\ntitle: T\n\nbody!\n\n[/fold]');
	});

	it('writes its opening line from new data', async () => {
		const m = await mounted(FOLD_SAMPLE);
		const block = m.instance.doc.blocks[0] as Block<FoldData>;
		await m.instance.edit().data(block, { open: true }).commit();
		await m.settle();
		expect(m.source()).toBe('[fold open]\ntitle: T\n\nbody\n\n[/fold]\n');
	});
});
