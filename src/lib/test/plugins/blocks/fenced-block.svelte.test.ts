// @vitest-environment jsdom
// A plugin's `fencedBlock`: a code fence with its info string, or its own opening and closing lines,
// read by the editors that run the plugin; a written body line never closes it early, and a
// completion that wouldn't read back as it is refused.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import type { FencedBlockSpec } from '#lib/schema/block-shapes.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	pressKeyAt,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(destroyMountedEditors);

function fenced(spec: Partial<FencedBlockSpec>) {
	return definePlugin({
		name: 'fences',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({
			blocks: [
				fencedBlock({
					name: 'demo',
					label: 'Demo',
					fence: { info: 'demo' },
					sample: '```demo\nx\n```',
					insert: { none: 'a test block type' },
					...spec
				} as FencedBlockSpec)
			]
		})
	});
}

const kindAt = (m: ReturnType<typeof mountEditor>, i: number) => m.instance.getBlockKindAt([i]);

describe('a fenced block on a code fence', () => {
	it('takes the fence with its info string, and leaves the others to the code block', async () => {
		const source = '```demo\nx\n```\n\n```js\ny\n```\n';
		const m = mountEditor({ source, plugins: [fenced({})] });
		const plain = mountEditor({ source, plugins: [] });
		await m.settle();
		expect([kindAt(m, 0), kindAt(m, 1)]).toEqual(['fences/demo', 'fencedCode']);
		expect(kindAt(plain, 0)).toBe('fencedCode');
	});

	it('grows its fence when a body line would close it', async () => {
		const m = mountEditor({ source: '```demo\nx\n```\n', plugins: [fenced({})] });
		await m.settle();
		typeInto(surfaceAt(m, [0]), '```demo\n```\nx\n```');
		await m.settle();
		expect(m.instance.getSource()).toBe('````demo\n```\nx\n````\n');
		expect(kindAt(m, 0)).toBe('fences/demo');
	});
});

describe('a fenced block on its own lines', () => {
	const own = (escape?: (line: string) => string) =>
		fenced({
			fence: { open: /^%%begin$/, close: '%%end', ...(escape ? { escape } : {}) },
			sample: '%%begin\nx\n%%end',
			insert: { none: 'a test block type' }
		});

	it('is its opening line to its closing line', async () => {
		const m = mountEditor({ source: '%%begin\nx\n%%end\n', plugins: [own()] });
		await m.settle();
		expect(kindAt(m, 0)).toBe('fences/demo');
	});

	it('waits as plain text until its closer arrives', async () => {
		const m = mountEditor({ source: '%%begin\nx\n', plugins: [own()] });
		await m.settle();
		expect(kindAt(m, 0)).toBe('paragraph');
	});

	it.each([
		['a cut closing line', '%%begin\nx'],
		['a cut down to the opener', '%%begin'],
		['text typed onto the closing line', '%%begin\nx\n%%end y']
	])('gets its closer back after %s, once', async (_name, typed) => {
		const m = mountEditor({ source: '%%begin\nx\n%%end\n\nafter\n', plugins: [own()] });
		await m.settle();
		typeInto(surfaceAt(m, [0]), typed);
		await m.settle();
		expect(m.instance.getSource()).toBe(`${typed}\n%%end\n\nafter\n`);
		expect([kindAt(m, 0), kindAt(m, 1)]).toEqual(['fences/demo', 'paragraph']);
	});

	it('escapes a body line that would close it early', async () => {
		const m = mountEditor({ source: '%%begin\nx\n%%end\n', plugins: [own((line) => ` ${line}`)] });
		await m.settle();
		typeInto(surfaceAt(m, [0]), '%%begin\n%%end\nx\n%%end');
		await m.settle();
		expect(m.instance.getSource()).toBe('%%begin\n %%end\nx\n%%end\n');
		expect(kindAt(m, 0)).toBe('fences/demo');
	});
});

describe('a completion', () => {
	const completing = (lines: string[]) =>
		fenced({
			fence: { open: /^\$\$$/, close: '$$' },
			sample: '$$\nx\n$$',
			insert: { none: 'a test block type' },
			complete: {
				on: 'enter',
				line: /^\$\$$/,
				complete: () => ({ lines, caret: { line: 1, col: 0 } })
			}
		});

	it('writes the full block when Enter is pressed on its line', async () => {
		const m = mountEditor({ source: '$$\n', plugins: [completing(['$$', '', '$$'])] });
		await m.settle();
		await pressKeyAt(m, [0], 2, { key: 'Enter' });
		await m.settle();
		expect(m.instance.getSource()).toBe('$$\n\n$$\n');
		expect(kindAt(m, 0)).toBe('fences/demo');
	});

	it("is refused when what it writes wouldn't read back as the block", async () => {
		const m = mountEditor({ source: '$$\n', plugins: [completing(['$$', '', 'not a closer'])] });
		await m.settle();
		await pressKeyAt(m, [0], 2, { key: 'Enter' });
		await m.settle();
		expect(m.instance.getSource()).not.toContain('not a closer');
	});
});
