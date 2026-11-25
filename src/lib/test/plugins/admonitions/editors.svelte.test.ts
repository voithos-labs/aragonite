// @vitest-environment jsdom
// The admonitions value in a mounted editor: listed alone it turns the directive grammar on, its
// boxes' data is the name alone, and the cycle writes that name as one undo step.
// Miss-analysis: the package's `setup` registration turned directives on page-wide and cycled
// through a raw rewrite of its own, so nothing held what a value listed alone reads, or the cycle
// through `edit().data`.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPluginMetadata, type Block, type CstNode } from '#lib/plugin.js';
import { admonitions } from '#packages/admonitions/src/index.js';
import { ADMONITION } from '#lib/test/support/admonitions-grammar.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { pressKey } from '#lib/test/harness/settle.js';

type Seam = { getDocument(): CstNode };

beforeAll(installLayoutStubs);
beforeEach(() => vi.stubGlobal('navigator', { platform: 'Win32' }));
afterEach(async () => {
	await destroyMountedEditors();
	vi.unstubAllGlobals();
});

const kinds = (blocks: readonly Block[]) => blocks.map((b) => b.type.name);

async function mounted(source: string): Promise<MountedEditor<Seam>> {
	const m = mountEditor<Seam>({ source, plugins: [admonitions] });
	await m.settle();
	return m;
}

const MOD_7 = { key: '7', ctrlKey: true };
const UNDO = { key: 'z', ctrlKey: true };

describe('an editor listing only admonitions', () => {
	it('reads every `:::` name, `::leaf` and `:text[]`, its own names as boxes', async () => {
		const source = ':::foo\nx\n:::\n\n::bar\n\na :baz[y] c\n\n:::note\nn\n:::\n';
		const m = await mounted(source);
		expect(kinds(m.instance.doc.blocks)).toEqual([
			'directiveContainer',
			'directiveLeaf',
			'paragraph',
			ADMONITION
		]);
		expect(m.target.querySelector('.directive-text-widget')).not.toBeNull();
		expect(m.source()).toBe(source);
	});

	it('keeps a box’s data its name while a key lands in `{.a}`', async () => {
		const m = await mounted(':::tip T {.a}\nbody\n:::\n');
		typeInto(surfaceAt(m, [0, 0]), ':::tip T {.ab}');
		await m.settle();
		expect(m.source()).toBe(':::tip T {.ab}\nbody\n:::\n');
		const box = m.instance.__test.getDocument().children![0];
		expect(getPluginMetadata(box)).toEqual({ name: 'tip' });
	});
});

describe('the cycle', () => {
	it('Mod+7 in the body writes the next name alone, one undo step', async () => {
		const m = await mounted('::::tip Pro tip {.a}\nA titled tip.\n::::\n');
		await pressKeyAt(m, [0, 1], 0, MOD_7);
		await m.settle();
		expect(m.source()).toBe('::::important Pro tip {.a}\nA titled tip.\n::::\n');
		await pressKey(surfaceAt(m, [0, 1]), UNDO);
		await m.settle();
		expect(m.source()).toBe('::::tip Pro tip {.a}\nA titled tip.\n::::\n');
	});

	it('Mod+7 on the title row cycles too, and the last name wraps to the first', async () => {
		const m = await mounted(':::caution\nx\n:::\n');
		await pressKeyAt(m, [0, 0], 3, MOD_7);
		await m.settle();
		expect(m.source()).toBe(':::note\nx\n:::\n');
	});
});
