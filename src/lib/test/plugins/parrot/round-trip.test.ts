// @vitest-environment jsdom
// The parrot's line read by an editor running the plugin, and its bytes kept whole.
import { afterEach, beforeAll, describe, it, expect } from 'vitest';
import { parse, serialize } from '#lib';
import { parrotPlugin, parrot } from '#packages/parrot/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

async function mounted(source: string) {
	const m = mountEditor({ source, plugins: [parrotPlugin()] });
	await m.settle();
	return m;
}

// Without the plugin, the marker is ordinary prose: bare GFM is the whole uninstall story.
describe('parrot is dormant where no editor runs it', () => {
	it('leaves a %%parrot line as a paragraph', () => {
		const src = '%%parrot party responsibly\n';
		expect(parse(src).children[0].kind).toBe('paragraph');
		expect(serialize(parse(src))).toBe(src);
	});
});

// The line takes the bare `%%parrot` prefix, with no separator required, so `%%parrots` is a parrot
// whose caption starts mid-word.
describe('parrot recognition', () => {
	const recognition: Array<[string, string, boolean]> = [
		['marker with a caption', '%%parrot party responsibly\n', true],
		['bare marker', '%%parrot\n', true],
		['no trailing newline', '%%parrot party', true],
		['prefix takes no separator', '%%parrots dance\n', true],
		['indented one space', ' %%parrot hi\n', false],
		['truncated marker', '%%parro\n', false],
		['single percent', '%parrot\n', false],
		['marker mid-line', 'see %%parrot\n', false]
	];
	it.each(recognition)('%s', async (_name, src, claimed) => {
		const m = await mounted(src);
		expect(m.instance.getBlockKindAt([0])).toBe(claimed ? parrot.name : 'paragraph');
	});

	it('interrupts an open paragraph, splitting the parrot onto its own block', async () => {
		const m = await mounted('intro\n%%parrot hi\n');
		expect([m.instance.getBlockKindAt([0]), m.instance.getBlockKindAt([1])]).toEqual([
			'paragraph',
			parrot.name
		]);
	});

	it('is recognized inside a blockquote', async () => {
		const m = await mounted('> %%parrot hi\n');
		expect(m.instance.getBlockKindAt([0])).toBe('blockquote');
		expect(m.instance.getBlockKindAt([0, 0])).toBe(parrot.name);
	});
});

describe('parrot round-trip', () => {
	it.each([
		'%%parrot party responsibly\n',
		'%%parrot\n',
		'Before\n\n%%parrot party responsibly\n\nAfter\n',
		'intro\n%%parrot hi\n',
		'> %%parrot hi\n',
		'%%parrot party',
		' %%parrot hi\n',
		'see %%parrot\n',
		'```\n%%parrot in code\n```\n'
	])('keeps %j whole', async (src) => {
		expect((await mounted(src)).source()).toBe(src);
	});
});
