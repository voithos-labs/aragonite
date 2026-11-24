// @vitest-environment jsdom
// Miss-analysis: a box wrote its body with a plain `replace`, which no row ran on a CRLF block or a
// body line spelling the fence, so the two writes 0.11.5's box got right had no expected result.
// `Draft.body`: a block's body replaced as `block.body` reads it, in the block's line ending, a fence
// grown past a body line that would close it, inside a container's markers; `body(b, b.body)`
// writes nothing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import type { Block } from '#lib/schema/doc-view.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

const box = () => ({ dom: document.createElement('div') });

const kinds = definePlugin({
	name: 'm',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			fencedBlock({
				name: 'diagram',
				label: 'Diagram',
				fence: { info: 'mermaid' },
				sample: '```mermaid\nx\n```',
				insert: { none: 'a test block type' },
				edit: 'box',
				draw: box
			}),
			fencedBlock({
				name: 'tex',
				label: 'Tex',
				fence: { open: /^\$\$/, close: '$$', oneLine: true },
				sample: ['$$\nx\n$$', '$$x$$'],
				insert: { none: 'a test block type' },
				edit: 'box',
				draw: box
			}),
			lineBlock({
				name: 'memo',
				label: 'Memo',
				match: /^@@ (?<text>.*)$/,
				sample: '@@ memo',
				insert: { none: 'a test block type' }
			}),
			lineBlock({
				name: 'rule',
				label: 'Rule',
				match: /^%%%$/,
				sample: '%%%',
				insert: { none: 'a test block type' }
			})
		]
	})
});

/** The first block of a plugin type, however deep. */
function blockOf(editor: ReturnType<typeof mountEditor>): Block<unknown> {
	for (const top of editor.instance.doc.blocks)
		for (const block of top.walk()) if (block.type.name.startsWith('m/')) return block;
	throw new Error('no plugin block in the document');
}

async function written(source: string, text: string) {
	const editor = mountEditor({ source, plugins: [kinds] });
	await editor.settle();
	const result = await editor.instance.edit().body(blockOf(editor), text).commit();
	await editor.settle();
	const after = editor.source();
	await editor.destroy();
	return { result, after };
}

describe('a body written', () => {
	// [source, the text a box hands back, the bytes 0.11.5's diagram box wrote for it]
	it.each([
		['~~~mermaid\nx\n~~~\n', 'y', '~~~mermaid\ny\n~~~\n'],
		['  ```mermaid\n  x\n  ```\n', 'y', '  ```mermaid\ny\n  ```\n'],
		['````mermaid\nx\n````\n', 'y', '````mermaid\ny\n````\n'],
		['```mermaid\r\nx\r\n```\r\n', 'y\nz', '```mermaid\r\ny\r\nz\r\n```\r\n'],
		['```mermaid\nx\n```\n', 'a\n```\nb', '````mermaid\na\n```\nb\n````\n'],
		['```mermaid\nx\n```\n', '', '```mermaid\n```\n'],
		['```mermaid\n```\n', 'y', '```mermaid\ny\n```\n'],
		['```mermaid\n', 'x\n', '```mermaid\nx\n\n'],
		['```mermaid\nx\n', 'y\nz', '```mermaid\ny\nz\n'],
		['```mermaid\nx\n```', 'y\nz', '```mermaid\ny\nz\n```']
	])('%j given %j writes %j', async (source, text, expected) => {
		const { result, after } = await written(source, text);
		expect(result).toEqual({ ok: true });
		expect(after).toBe(expected);
	});

	it.each([
		['> ```mermaid\n> x\n> ```\n', 'a\nb', '> ```mermaid\n> a\n> b\n> ```\n'],
		['- ```mermaid\n  x\n  ```\n', 'a\nb', '- ```mermaid\n  a\n  b\n  ```\n'],
		['> ```mermaid\n> x\n> y\n> ```\n', '', '> ```mermaid\n> ```\n'],
		['> ```mermaid\n> ```\n', 'a\nb', '> ```mermaid\n> a\n> b\n> ```\n'],
		['> ```mermaid\n> x\n> ```\n', '```', '> ````mermaid\n> ```\n> ````\n'],
		['> - ```mermaid\n>   x\n>   ```\n', 'a\nb', '> - ```mermaid\n>   a\n>   b\n>   ```\n']
	])('inside a container, %j given %j writes %j', async (source, text, expected) => {
		const { result, after } = await written(source, text);
		expect(result).toEqual({ ok: true });
		expect(after).toBe(expected);
	});

	it.each([
		['@@ hi\n', 'yo', '@@ yo\n'],
		['$$\nx\n$$\n', 'a\nb', '$$\na\nb\n$$\n']
	])('of %j given %j writes %j', async (source, text, expected) => {
		const { result, after } = await written(source, text);
		expect(result).toEqual({ ok: true });
		expect(after).toBe(expected);
	});

	it.each([
		['@@ hi\n', 'a\nb'],
		['%%%\n', 'x']
	])('of %j given %j is refused, writing nothing', async (source, text) => {
		const { result, after } = await written(source, text);
		expect(result).toMatchObject({ ok: false, reason: 'illegal' });
		expect(after).toBe(source);
	});

	it('of a block whose bytes changed since it was read is refused as moved', async () => {
		const editor = mountEditor({ source: '```mermaid\nx\n```\n', plugins: [kinds] });
		await editor.settle();
		const stale = blockOf(editor);
		await editor.instance.edit().body(stale, 'y').commit();
		await editor.settle();
		const result = await editor.instance.edit().body(stale, 'z').commit();
		expect(result).toMatchObject({ ok: false, reason: 'moved' });
		expect(editor.source()).toBe('```mermaid\ny\n```\n');
	});
});

// A tab leading a line inside a list item reads back as the columns it reaches past the item's
// indent, as GFM reads it, so the tab sits mid-line.
const line = fc.constantFrom(
	'x',
	'graph TD',
	'```',
	'~~~',
	'````',
	'  a',
	'é ü',
	'',
	'a\t-> b',
	'$$'
);
const ending = fc.constantFrom('\n', '\r\n');
const fenceBlock = fc
	.record({
		marker: fc.constantFrom('`', '~'),
		run: fc.integer({ min: 3, max: 5 }),
		indent: fc.constantFrom('', ' ', '   '),
		body: fc.array(fc.tuple(line, ending), { maxLength: 4 }),
		ending,
		closed: fc.boolean(),
		last: fc.boolean(),
		inside: fc.constantFrom('', '> ', '- ')
	})
	.map(({ marker, run, indent, body, ending, closed, last, inside }) => {
		const fence = marker.repeat(run);
		// A body line spelling the fence would close it; such a block is one the parser never makes.
		const kept = body.filter(([text]) => !text.trimStart().startsWith(fence.slice(0, 3)));
		const lines = [indent + fence + 'mermaid' + ending, ...kept.map(([t, e]) => indent + t + e)];
		if (closed) lines.push(indent + fence + (last ? '' : ending));
		const rest = inside === '- ' ? '  ' : inside;
		return lines.map((l, i) => (i === 0 ? inside : rest) + l).join('');
	});

describe('the law', () => {
	it('body(b, b.body) writes nothing, for every fence', async () => {
		await fc.assert(
			fc.asyncProperty(fenceBlock, async (source) => {
				const editor = mountEditor({ source, plugins: [kinds] });
				await editor.settle();
				const block = blockOf(editor);
				const result = await editor.instance.edit().body(block, block.body).commit();
				await editor.settle();
				expect(result.ok).toBe(false);
				expect(editor.source()).toBe(source);
				await editor.destroy();
			}),
			{ numRuns: 40 }
		);
	});

	it('after body(b, t) the block reads back as its type with t as its body', async () => {
		const text = fc.array(line, { maxLength: 4 }).map((lines) => lines.join('\n'));
		await fc.assert(
			fc.asyncProperty(fenceBlock, text, async (source, t) => {
				const editor = mountEditor({ source, plugins: [kinds] });
				await editor.settle();
				const ending = source.includes('\r\n') ? '\r\n' : '\n';
				await editor.instance.edit().body(blockOf(editor), t).commit();
				await editor.settle();
				const block = blockOf(editor);
				expect(block.type.name).toBe('m/diagram');
				expect(block.body).toBe(t.replace(/\n/g, ending));
				await editor.destroy();
			}),
			{ numRuns: 40 }
		);
	});
});
