// @vitest-environment jsdom
// `Draft.data`: a block's data written into only the bytes that carry it, as one undo step, inside
// a container's markers too; refused when the block changed since it was read or its type has no
// writer for data.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { container } from '#lib/components/block-makers/container.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { TextDrawContext } from '#lib/schema/drawing.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

/** The last block each drawing was handed, by its text's first line. */
const seen = new Map<string, Block<unknown>>();

function remember(block: Block<unknown>, ctx: TextDrawContext) {
	const dom = document.createElement('div');
	dom.append(ctx.source);
	seen.set(block.text.split('\n')[0], block);
	return { dom, update: (next: Block<unknown>) => void seen.set(next.text.split('\n')[0], next) };
}

const levels = definePlugin({
	name: 'levels',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			lineBlock({
				name: 'level',
				label: 'Level',
				match: /^%%(?<n>\d) (?<text>.*)$/,
				data: (m) => Number(m.groups!.n),
				write: (n, text) => `%%${n} ${text}`,
				sample: '%%1 hi',
				insert: { none: 'a test block type' },
				edit: 'text',
				draw: remember
			}),
			lineBlock({
				name: 'unwritten',
				label: 'Unwritten',
				match: (line) => (line.startsWith('%%u ') ? { text: [4, line.length], data: 1 } : null),
				sample: '%%u hi',
				insert: { none: 'a test block type' },
				edit: 'text',
				draw: remember
			}),
			container({
				name: 'alert',
				label: 'Alert',
				sample: '%> [!NOTE]\n%> x',
				insert: { none: 'a test block type' },
				lines: {
					shape: 'marked',
					first: '%> ',
					rest: '%> ',
					reads: /^%> ?/,
					lazy: true,
					head: {
						match: /^\[!(\w+)\]$/,
						data: (m: RegExpExecArray) => ({ type: m[1] }),
						write: (data: { type: string }) => `[!${data.type}]`
					}
				},
				draw: (block, ctx) => {
					seen.set('alert', block);
					const dom = document.createElement('div');
					dom.append(ctx.children);
					return { dom, update: (next) => void seen.set('alert', next) };
				}
			})
		]
	})
});

async function mounted(source: string) {
	seen.clear();
	const editor = mountEditor({ source, plugins: [levels] });
	await editor.settle();
	return editor;
}

describe('Draft.data', () => {
	it("rewrites a line block's data through its writer, as one undo step", async () => {
		const editor = await mounted('intro\n\n%%1 hello\n');
		const result = await editor.instance
			.edit()
			.data(seen.get('%%1 hello') as Block<number>, 3)
			.commit();
		await editor.settle();
		expect(result).toEqual({ ok: true });
		expect(editor.source()).toBe('intro\n\n%%3 hello\n');
		editor.instance.run('history.undo');
		await editor.settle();
		expect(editor.source()).toBe('intro\n\n%%1 hello\n');
	});

	it('keeps the markers of the containers around the block', async () => {
		const editor = await mounted('> %%1 hello\n> %%2 there\n');
		const result = await editor.instance
			.edit()
			.data(seen.get('%%2 there') as Block<number>, 5)
			.commit();
		await editor.settle();
		expect(result).toEqual({ ok: true });
		expect(editor.source()).toBe('> %%1 hello\n> %%5 there\n');
	});

	it("rewrites a container's head line and leaves its children's bytes alone", async () => {
		const editor = await mounted('%> [!NOTE]\n%> %%1 inside\n');
		const alert = seen.get('alert') as Block<{ type: string }>;
		const result = await editor.instance.edit().data(alert, { type: 'WARNING' }).commit();
		await editor.settle();
		expect(result).toEqual({ ok: true });
		expect(editor.source()).toBe('%> [!WARNING]\n%> %%1 inside\n');
	});

	it('is refused as moved once the block was edited after it was read', async () => {
		const editor = await mounted('%%1 hello\n');
		const stale = seen.get('%%1 hello') as Block<number>;
		typeInto(surfaceAt(editor, [0]), '%%1 hello!');
		await editor.settle();
		const result = await editor.instance.edit().data(stale, 4).commit();
		expect(result).toMatchObject({ ok: false, reason: 'moved' });
		expect(editor.source()).toBe('%%1 hello!\n');
	});

	it('is refused as illegal for a block type with no writer for its data', async () => {
		const editor = await mounted('%%u hello\n');
		const block = seen.get('%%u hello') as Block<number>;
		const result = await editor.instance.edit().data(block, 2).commit();
		expect(result).toMatchObject({ ok: false, reason: 'illegal' });
	});
});
