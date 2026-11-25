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
import { freshOrFixedSeed } from '#lib/test/invariants/arbitraries/property-seed.js';
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
		['```mermaid\nx\n```', 'y\nz', '```mermaid\ny\nz\n```'],
		// Miss-analysis: every closer drawn matched its opener's run, so none was already long enough.
		[
			'```mermaid\ngraph TD\n  `````  \n',
			'graph TD\n```',
			'````mermaid\ngraph TD\n```\n  `````  \n'
		],
		['~~~mermaid\nx\n~~~~~\n', 'a\n~~~', '~~~~mermaid\na\n~~~\n~~~~~\n'],
		['```mermaid\n`````\n', '```', '````mermaid\n```\n`````\n'],
		['```mermaid\nx\n````\n', 'a\n`````', '``````mermaid\na\n`````\n``````\n']
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
		['> ```mermaid\n> x\n> `````\n', '```', '> ````mermaid\n> ```\n> `````\n'],
		['> - ```mermaid\n>   x\n>   ```\n', 'a\nb', '> - ```mermaid\n>   a\n>   b\n>   ```\n']
	])('inside a container, %j given %j writes %j', async (source, text, expected) => {
		const { result, after } = await written(source, text);
		expect(result).toEqual({ ok: true });
		expect(after).toBe(expected);
	});

	// Miss-analysis: the one-line `$$x$$` rows were declared in the fixture and never written, so a
	// text of lines split it into a formula and a paragraph and still answered ok.
	it.each([
		['@@ hi\n', 'yo', '@@ yo\n'],
		['$$\nx\n$$\n', 'a\nb', '$$\na\nb\n$$\n'],
		['$$x$$\n', 'y', '$$y$$\n'],
		['$$x$$\n', 'a\nb', '$$\na\nb\n$$\n'],
		['$$x$$\r\n', 'a\nb', '$$\r\na\r\nb\r\n$$\r\n'],
		['> $$x$$\n', 'a\nb', '> $$\n> a\n> b\n> $$\n']
	])('of %j given %j writes %j', async (source, text, expected) => {
		const { result, after } = await written(source, text);
		expect(result).toEqual({ ok: true });
		expect(after).toBe(expected);
	});

	// Miss-analysis: the property drew no empty one-line body, and a text opening and closing with a
	// line break only by chance, so a body whose splice already spelled fence lines went unwritten.
	it.each([
		['$$x$$\n', '\n', '$$\n\n\n$$\n'],
		['$$x$$\n', '\nb\n', '$$\n\nb\n\n$$\n'],
		['$$x$$\r\n', '\n', '$$\r\n\r\n\r\n$$\r\n'],
		['- $$x$$\n', '\nb\n', '- $$\n  \n  b\n  \n  $$\n'],
		['$$$$\n', 'y', '$$y$$\n'],
		['$$$$\n', 'a\nb', '$$\na\nb\n$$\n'],
		['$$$$', '\n', '$$\n\n\n$$']
	])('of the one-line %j given %j writes %j, reading the text back', async (source, text, want) => {
		const editor = mountEditor({ source, plugins: [kinds] });
		await editor.settle();
		const result = await editor.instance.edit().body(blockOf(editor), text).commit();
		await editor.settle();
		expect(result).toEqual({ ok: true });
		expect(editor.source()).toBe(want);
		expect(blockOf(editor).body).toBe(text.replace(/\n/g, source.includes('\r') ? '\r\n' : '\n'));
	});

	// The last two: a fence with a fixed closer and no `escape` can't hold a line spelling it.
	it.each([
		['@@ hi\n', 'a\nb'],
		['%%%\n', 'x'],
		['$$\nx\n$$\n', 'a\n$$\nb'],
		['$$x$$\n', 'a\n$$\nb']
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
		// A closer may run longer than its opener and carry trailing spaces.
		longer: fc.integer({ min: 0, max: 2 }),
		trail: fc.constantFrom('', '  '),
		last: fc.boolean(),
		inside: fc.constantFrom('', '> ', '- ')
	})
	.map(({ marker, run, indent, body, ending, closed, longer, trail, last, inside }) => {
		const fence = marker.repeat(run);
		// A body line of the fence's marker, as long or longer, would close it.
		const closes = new RegExp(`^${marker}{${run},}[ \\t]*$`);
		const kept = body.filter(([text]) => !closes.test(text.trimStart()));
		const lines = [indent + fence + 'mermaid' + ending, ...kept.map(([t, e]) => indent + t + e)];
		const closer = indent + marker.repeat(run + longer) + trail;
		if (closed) lines.push(closer + (last ? '' : ending));
		const rest = inside === '- ' ? '  ' : inside;
		return lines.map((l, i) => (i === 0 ? inside : rest) + l).join('');
	});

// A `$$` block, one-line or on fence lines; a body line spelling its closer would end it.
const texBlock = fc
	.record({
		one: fc.boolean(),
		body: fc.array(fc.tuple(line, ending), { minLength: 1, maxLength: 3 }),
		ending,
		inside: fc.constantFrom('', '> ', '- ')
	})
	.map(({ one, body, ending, inside }) => {
		const kept = body.filter(([text]) => text !== '$$' && text !== '');
		const lines = one
			? [`$$${kept[0]?.[0] ?? ''}$$${ending}`]
			: ['$$' + ending, ...kept.map(([t, e]) => t + e), '$$' + ending];
		const rest = inside === '- ' ? '  ' : inside;
		return lines.map((l, i) => (i === 0 ? inside : rest) + l).join('');
	});
const anyBlock = fc.oneof(fenceBlock, texBlock);

const PARAMS = { numRuns: 60, seed: freshOrFixedSeed(115053448) } as const;

/** The marker run of the line closing the source's fence, or null where its last line closes none. */
function closerRun(source: string): number | null {
	const lines = source.split(/\r?\n/).filter((line) => line !== '');
	// After the markers of the quote or the item around the block.
	const opener = /^(?:> |- )? {0,3}(`{3,}|~{3,})/.exec(lines[0])?.[1];
	const last = lines.length > 1 ? lines[lines.length - 1] : '';
	const closer = /^(?:> | {2})? {0,3}(`{3,}|~{3,})[ \t]*$/.exec(last)?.[1];
	const closes = opener && closer?.[0] === opener[0] && closer.length >= opener.length;
	return closes ? closer.length : null;
}

describe('the law', () => {
	// Miss-analysis: the property drew code fences alone and asked only with the body as read, which
	// the writer answers before it writes anything, so no run reached a `$$` block or a field's text.
	it('body(b, b.body) writes nothing, as read or as a field hands it back', async () => {
		await fc.assert(
			fc.asyncProperty(anyBlock, async (source) => {
				const editor = mountEditor({ source, plugins: [kinds] });
				await editor.settle();
				const block = blockOf(editor);
				// A field's text of a block mixing endings takes CRLF on every line, by design.
				const mixed = source.includes('\r\n') && /(^|[^\r])\n/.test(source);
				const field = mixed ? [] : [block.body.replace(/\r\n/g, '\n')];
				for (const text of [block.body, ...field]) {
					const result = await editor.instance.edit().body(block, text).commit();
					await editor.settle();
					expect(result.ok).toBe(false);
					expect(editor.source()).toBe(source);
				}
				await editor.destroy();
			}),
			PARAMS
		);
	});

	it('after body(b, t) the block reads back with t as its body, or writes nothing', async () => {
		const text = fc.array(line, { maxLength: 4 }).map((lines) => lines.join('\n'));
		await fc.assert(
			fc.asyncProperty(anyBlock, text, async (source, t) => {
				const editor = mountEditor({ source, plugins: [kinds] });
				await editor.settle();
				const type = blockOf(editor).type.name;
				const ending = source.includes('\r\n') ? '\r\n' : '\n';
				const result = await editor.instance.edit().body(blockOf(editor), t).commit();
				await editor.settle();
				if (!result.ok && result.reason === 'illegal') {
					// Only a `$$` block refuses, for a line that would end it.
					expect(type).toBe('m/tex');
					expect(t.split('\n')).toContain('$$');
					expect(editor.source()).toBe(source);
				} else {
					const block = blockOf(editor);
					expect(block.type.name).toBe(type);
					expect(block.body).toBe(t.replace(/\n/g, ending));
					// A closer that closed the block is never written shorter.
					const before = closerRun(source);
					if (before !== null) expect(closerRun(editor.source())).toBeGreaterThanOrEqual(before);
				}
				await editor.destroy();
			}),
			PARAMS
		);
	});
});
