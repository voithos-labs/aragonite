// @vitest-environment jsdom
// An `inline()` widget in a mounted editor: what its drawing gets and when it's told again, the
// follow the editor runs on the host's click, `key`'s props, a class, and two editors on one page.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tick } from 'svelte';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import { definePlugin, inline, type WidgetProps } from '#lib/plugin.js';
import { keyOwnWidget } from '#lib/components/blocks/widget-portal.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';

beforeEach(() => installLayoutStubs());
afterEach(() => destroyMountedEditors());

type Note = { target: string };

function wiki() {
	const drawn: WidgetProps<Note>[] = [];
	const followed: string[] = [];
	const note = inline({
		name: 'note',
		label: 'Note',
		prefix: '[[',
		match: /\[\[([^\]\n]+)\]\]/,
		read: (m) => ({ target: m[1] }),
		sample: '[[note]]',
		widget: { delete: 'whole', arrows: 'select', click: 'follow' },
		draw(target, props) {
			target.textContent = props.data.target;
			drawn.push(props);
			return { update: (next) => void drawn.push(next) };
		},
		follow: (data) => void followed.push(data.target),
		key(event, props) {
			if (event.key !== 'x') return false;
			void props.editor.edit().replace(props, 'X').commit();
			return true;
		}
	});
	const tag = inline({
		name: 'tag',
		label: 'Tag',
		prefix: '#',
		match: /#\w+/,
		read: () => true,
		sample: '#tag',
		class: 'harness-tag'
	});
	const plugin = definePlugin({
		name: 'wiki',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ inlines: [note, tag] })
	});
	return { plugin, drawn, followed };
}

const SOURCE = 'intro\n\nsee [[note]] and #tag\n';
const CELL_SOURCE = 'see [[note]]\n\n| a |\n| - |\n| x [[cell]] |\n';
const shellIn = (host: HTMLElement) => host.querySelector<HTMLElement>('[data-inline-widget]')!;

describe('an inline() widget in a mounted editor', () => {
	it('draws with its data, its bytes, the mode, the theme and its plugin editor', async () => {
		const { plugin, drawn } = wiki();
		const editor = mountEditor({ source: SOURCE, plugins: [plugin], presentationMode: 'live' });
		await editor.settle();
		expect(shellIn(blockHostAt(editor, [1])).textContent).toBe('note');
		const [props] = drawn;
		expect(props).toMatchObject({
			data: { target: 'note' },
			source: '[[note]]',
			mode: { name: 'live', editable: true }
		});
		expect(props.theme).toBeTypeOf('string');
		expect(props.editor.plugins).toContain('wiki');
		expect([props.from, props.to]).toEqual([11, 19]);
	});

	it('reads `from` when asked, so `key` writes at its bytes after an edit above', async () => {
		const { plugin, drawn } = wiki();
		const editor = mountEditor({ source: SOURCE, plugins: [plugin], presentationMode: 'live' });
		await editor.settle();
		typeInto(surfaceAt(editor, [0]), 'intro more');
		await editor.settle();
		expect(drawn.at(-1)!.from).toBe(16);
		const shell = shellIn(blockHostAt(editor, [1]));
		expect(keyOwnWidget(shell, new KeyboardEvent('keydown', { key: 'x' }))).toBe(true);
		await editor.settle();
		expect(editor.source()).toBe('intro more\n\nsee X and #tag\n');
	});

	it('is told the new mode when the editor switches', async () => {
		const { plugin, drawn } = wiki();
		const editor = mountEditor({ source: SOURCE, plugins: [plugin], presentationMode: 'live' });
		await editor.settle();
		editor.props.presentationMode = 'reading';
		await editor.settle();
		expect(drawn.at(-1)!.mode.name).toBe('reading');
	});

	it("runs `follow` on the host's link click, and not on a double click", async () => {
		const { plugin, followed } = wiki();
		const editor = mountEditor({
			source: SOURCE,
			plugins: [plugin],
			presentationMode: 'live',
			linkClick: 'plain'
		});
		await editor.settle();
		const shell = shellIn(blockHostAt(editor, [1]));
		shell.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
		expect(followed).toEqual([]);
		shell.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
		expect(followed).toEqual(['note']);
	});

	it('draws a class construct as its bytes with its class', async () => {
		const { plugin } = wiki();
		const editor = mountEditor({ source: SOURCE, plugins: [plugin] });
		await editor.settle();
		expect(blockHostAt(editor, [1]).querySelector('.harness-tag')?.textContent).toBe('#tag');
	});

	it('two editors on one page read the bytes by their own lists', async () => {
		const { plugin } = wiki();
		const listed = mountEditor({ source: SOURCE, plugins: [plugin] });
		const unlisted = mountEditor({ source: SOURCE, plugins: [] });
		await listed.settle();
		await unlisted.settle();
		await tick();
		expect(blockHostAt(listed, [1]).querySelector('[data-inline-widget]')).not.toBeNull();
		expect(blockHostAt(unlisted, [1]).querySelector('[data-inline-widget]')).toBeNull();
	});

	it('is told the new theme, in a paragraph and in a table cell', async () => {
		const { plugin, drawn } = wiki();
		const editor = mountEditor({ source: CELL_SOURCE, plugins: [plugin], theme: 'light' });
		await editor.settle();
		editor.props.theme = 'dark';
		await editor.settle();
		const latest = new Map(drawn.map((props) => [props.source, props]));
		expect(latest.get('[[note]]')!.theme).toBe('dark');
		expect(latest.get('[[cell]]')!.theme).toBe('dark');
	});

	it('reads its document bytes in a table cell', async () => {
		const { plugin, drawn } = wiki();
		const editor = mountEditor({ source: CELL_SOURCE, plugins: [plugin] });
		await editor.settle();
		const cell = drawn.find((props) => props.source === '[[cell]]')!;
		expect(editor.source().slice(cell.from, cell.to)).toBe('[[cell]]');
	});

	it('builds no inline table on a keystroke, with constructs listed or none', async () => {
		for (const plugins of [[wiki().plugin], []]) {
			const editor = mountEditor({ source: SOURCE, plugins });
			await editor.settle();
			resetPerfInstruments();
			enablePerfInstruments();
			try {
				for (let i = 1; i <= 20; i++) typeInto(surfaceAt(editor, [0]), 'intro' + 'x'.repeat(i));
				await editor.settle();
				expect(perfSnapshot().inlineTableBuilds).toBe(0);
			} finally {
				disablePerfInstruments();
			}
			await editor.destroy();
		}
	});

	it('use() turns the construct off and on again', async () => {
		const { plugin } = wiki();
		const editor = mountEditor({ source: SOURCE, plugins: [plugin] });
		await editor.settle();
		const widgets = () => blockHostAt(editor, [1]).querySelectorAll('[data-inline-widget]');
		editor.instance.use([]);
		await editor.settle();
		expect(widgets()).toHaveLength(0);
		editor.instance.use([plugin]);
		await editor.settle();
		expect(widgets()).toHaveLength(1);
	});

	// A parse that falls back to the table of every installed plugin reads none of an editor's own
	// constructs, so it would draw `[[note]]` as text wherever such a path runs.
	it("asks no table of every plugin's syntax through a session", async () => {
		const { plugin } = wiki();
		resetPerfInstruments();
		enablePerfInstruments();
		try {
			const editor = mountEditor({ source: SOURCE, plugins: [plugin], presentationMode: 'live' });
			await editor.settle();
			typeInto(surfaceAt(editor, [1]), 'see [[note]] and #tag [[more]]');
			await editor.settle();
			editor.props.presentationMode = 'source';
			await editor.settle();
			expect(perfSnapshot().everyPluginTableReads).toBe(0);
			expect(blockHostAt(editor, [1]).querySelectorAll('[data-inline-widget]')).toHaveLength(2);
		} finally {
			disablePerfInstruments();
		}
	});
});
