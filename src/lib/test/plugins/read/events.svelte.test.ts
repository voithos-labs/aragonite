// @vitest-environment jsdom
// What `Editor.on` hears: each write as an `edit` with the document after it and the bytes it
// replaced, a whole document replaced as `load`, the mode as its facets, and the selection read
// only when asked.
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { definePluginUnit, type Editor } from '#lib/schema/plugin-unit.js';
import type { Change, EditInfo, Events } from '#lib/editor-events.js';
import { modeOf } from '#lib/presentation-mode.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	pressKeyAt,
	surfaceAt,
	typeInto,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';

beforeAll(() => installLayoutStubs());
afterEach(async () => {
	disablePerfInstruments();
	await destroyMountedEditors();
});

const DOC = 'intro\n\n- ant\n- bee\n\npara one\n';

async function mounted(source: string, listen?: (editor: Editor) => void) {
	let editor: Editor | undefined;
	const reader = definePluginUnit({
		name: 'unit-reader',
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ setup: (e) => void ((editor = e), listen?.(e)) })
	});
	const m = mountEditor({ source, plugins: [reader] });
	await m.settle();
	return { editor: editor!, m };
}

/** Every payload `event` hands a listener over `run`. */
async function heard<K extends keyof Events>(editor: Editor, event: K, run: () => Promise<void>) {
	const payloads: Events[K][] = [];
	const off = editor.on(event, (payload) => payloads.push(payload));
	await run();
	off();
	return payloads;
}

const applied = (text: string, changes: readonly Change[]) =>
	[...changes]
		.reverse()
		.reduce((out, c) => out.slice(0, c.from) + c.insert + out.slice(c.to), text);

async function typeAt(m: MountedEditor, path: number[], text: string): Promise<void> {
	typeInto(surfaceAt(m, path), text);
	await m.settle();
}

describe('edit', () => {
	it('hands every listener one payload: the op, the document after it and what it replaced', async () => {
		const { editor, m } = await mounted(DOC);
		const other: EditInfo[] = [];
		editor.on('edit', (info) => other.push(info));
		const [info] = await heard(editor, 'edit', () => typeAt(m, [2], 'para oneX'));
		expect(other[0]).toBe(info);
		expect([info.op, info.doc.text, info.doc.current]).toEqual(['input', m.source(), true]);
		expect(info.changes).toEqual([{ from: 19, to: 29, insert: '\npara oneX\n' }]);
		expect(applied(DOC, info.changes)).toBe(m.source());
	});

	it('says what an Enter in a list and an undo replaced', async () => {
		const { editor, m } = await mounted(DOC);
		let before = DOC;
		const infos = await heard(editor, 'edit', async () => {
			await pressKeyAt(m, [1, 0, 0], 'ant'.length, { key: 'Enter' });
			before = m.source();
			editor.run('history.undo');
			await m.settle();
		});
		expect(infos.map((info) => info.op)).toEqual(['appendBlock', 'undo']);
		expect(applied(DOC, infos[0].changes)).toBe(before);
		expect(applied(before, infos[1].changes)).toBe(DOC);
	});

	// Miss-analysis: a new cost; `edit` carried a path and no bytes before.
	it('reads no tree for a listener that never reads changes, at 40 blocks as at 400', async () => {
		const cost = async (n: number) => {
			const source = Array.from({ length: n }, (_, i) => `line ${i}\n`).join('\n');
			let ops = 0;
			const { m } = await mounted(source, (e) => void e.on('edit', () => ops++));
			await typeAt(m, [1], 'line 1x');
			resetPerfInstruments();
			enablePerfInstruments();
			await typeAt(m, [1], 'line 1xy');
			await typeAt(m, [1], 'line 1xyz');
			const { textReads, documentWalks, byteMapReads, topBlocksMeasured } = perfSnapshot();
			disablePerfInstruments();
			expect(ops).toBe(3);
			await m.destroy();
			return { textReads, documentWalks, byteMapReads, topBlocksMeasured };
		};
		const small = await cost(40);
		expect(small).toMatchObject({ textReads: 0, documentWalks: 0, byteMapReads: 0 });
		expect(await cost(400)).toEqual(small);
	});
});

describe('load', () => {
	// Miss-analysis: a new home; the swap was heard only as `sourceSwap`, a name the plugin map drops.
	it('fires once for a source swap, with the new document, and no edit fires', async () => {
		const { editor, m } = await mounted(DOC);
		const edits = await heard(editor, 'edit', async () => {
			const loads = await heard(editor, 'load', async () => {
				m.props.source = 'fresh\n';
				await m.settle();
			});
			expect(loads.map((load) => [load.generation, load.doc.text, load.doc.current])).toEqual([
				[1, 'fresh\n', true]
			]);
		});
		expect(edits).toEqual([]);
	});
});

describe('mode', () => {
	it('reads as its facets, on the editor and in the event', async () => {
		const { editor, m } = await mounted(DOC);
		expect(editor.mode).toBe(modeOf('source'));
		const modes = await heard(editor, 'mode', async () => {
			m.props.presentationMode = 'reading';
			await m.settle();
		});
		expect(modes).toEqual([{ name: 'reading', editable: false, markers: 'hidden' }]);
		expect([editor.mode, m.instance.mode]).toEqual([modes[0], modes[0]]);
		expect(m.instance.mode).toBe(modes[0]);
	});
});

describe('selection', () => {
	it('places no byte for a listener that never reads it, and the caret for one that does', async () => {
		const { editor, m } = await mounted(DOC);
		const seen = await heard(editor, 'selection', async () => {
			enablePerfInstruments();
			resetPerfInstruments();
			placeCaret(surfaceAt(m, [1, 1, 0]), 1);
			document.dispatchEvent(new Event('selectionchange'));
			await m.settle();
			expect(perfSnapshot().byteMapReads).toBe(0);
		});
		expect(seen.length).toBeGreaterThan(0);
		expect(seen.at(-1)!.selection).toMatchObject({ head: DOC.indexOf('ee'), empty: true });
	});
});
