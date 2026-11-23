// @vitest-environment jsdom
import { afterEach, beforeAll, describe, it, expect } from 'vitest';
import { grammar } from '#lib/plugin.js';
import { toc } from '#packages/toc/src/index.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

const TOC = 'toc/toc';
const kinds = (source: string, plugins = [toc]) =>
	grammar(plugins)
		.parse(source)
		.blocks.map((block) => block.type.name);

// Without the plugin `[[toc]]` is an ordinary paragraph, byte-identical to plain GFM.
describe('toc is dormant where no editor lists it', () => {
	it('leaves a [[toc]] line as a paragraph', () => {
		const source = '# H\n\n[[toc]]\n';
		expect(kinds(source, [])).toEqual(['heading', 'paragraph']);
	});
});

// The opener takes only the exact line `[[toc]]`; indentation or trailing content stays a
// paragraph, which keeps the opener out of every other plugin's documents.
describe('toc recognition', () => {
	const recognition: Array<[string, string, boolean]> = [
		['exact line', '[[toc]]\n', true],
		['exact line, no trailing newline', '[[toc]]', true],
		['indented one space', ' [[toc]]\n', false],
		['trailing content', '[[toc]] contents\n', false],
		['leading content', 'see [[toc]]\n', false],
		['uppercase', '[[TOC]]\n', false],
		['single bracket', '[toc]\n', false]
	];
	for (const [name, source, recognized] of recognition) {
		it(`${name} → ${recognized ? 'toc' : 'paragraph'}`, () => {
			expect(kinds(source)[0]).toBe(recognized ? TOC : 'paragraph');
		});
	}

	it('reads the line as one block with no children', () => {
		const [block] = grammar([toc]).parse('[[toc]]\n').blocks;
		expect(block.type.name).toBe(TOC);
		expect(block.children).toEqual([]);
		expect(block.text).toBe('[[toc]]\n');
	});

	it('interrupts an open paragraph, splitting the toc onto its own block', () => {
		expect(kinds('intro\n[[toc]]\n')).toEqual(['paragraph', TOC]);
	});

	it('recognizes a [[toc]] nested inside a blockquote', () => {
		const [quote] = grammar([toc]).parse('> [[toc]]\n').blocks;
		expect(quote.type.name).toBe('blockquote');
		expect(quote.children.map((child) => child.type.name)).toEqual([TOC]);
	});
});

// An editor running the plugin writes the bytes back as it read them; the declined rows prove the
// shapes the opener does not take keep their bytes too.
describe('toc round-trip', () => {
	it.each([
		'[[toc]]\n',
		'# Overview\n\n## Details\n\n[[toc]]\n\nFooter\n',
		'Appendix\n========\n\n[[toc]]\n',
		'> [[toc]]\n',
		'# H\n\n> [[toc]]\n\nAfter\n',
		'intro\n[[toc]]\n',
		' [[toc]]\n',
		'[[toc]] contents\n',
		'[[toc]]'
	])('keeps %j whole', async (source) => {
		const m = mountEditor({ source, plugins: [toc] });
		await m.settle();
		expect(m.source()).toBe(source);
	});
});
