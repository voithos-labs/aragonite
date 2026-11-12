// @vitest-environment jsdom
// The byte splice as a commit: the bytes it's handed land as one undo entry and one edit event,
// blocks it didn't reach keep their ids, the caret lands at its byte (in text, on a block held
// whole, or between blocks), equal bytes write nothing, and reading mode refuses it.

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { EditorTestSurface } from '#lib/components/editor-root/test-surface.js';
import type { SpliceCaret } from '#lib/action-contracts.js';
import type { PresentationMode } from '#lib/presentation-mode.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { serialize } from '#lib/core/serializer.js';
import { docPathFrom } from '#lib/core/coordinate-spaces.js';
import { SYNTAX_PLUGINS } from '../behavior/corpus';
import { makeEditorActionsDeps } from '../harness/editor-actions';

const OP = { kind: 'delete', detail: { crossBlock: true } } as const;
const text = (at: number): SpliceCaret => ({ at, holds: 'text' });

beforeAll(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	expect(takeDevWarns()).toEqual([]);
});

async function mounted(source: string, presentationMode: PresentationMode = 'source') {
	const editor = mountEditor<EditorTestSurface>({
		source,
		presentationMode,
		plugins: SYNTAX_PLUGINS
	});
	await editor.settle();
	return editor;
}

describe('a byte splice', () => {
	it('lands its bytes as one undo entry and one edit event', async () => {
		const editor = await mounted('one\n\ntwo\n\nthree\n');
		const events: string[] = [];
		editor.instance.getEvents().on('edit', (e) => events.push(`${e.op} ${e.path.join('.')}`));
		const surface = editor.instance.__test;
		expect(await surface.spliceSource('one\n\ntwX\n\nthree\n', text(8), OP)).toBe(true);
		await editor.settle();
		expect(editor.source()).toBe('one\n\ntwX\n\nthree\n');
		expect(surface.getUndoStack().undo).toHaveLength(1);
		expect(events).toEqual(['delete 1']);
		editor.instance.runCommand('history.undo');
		await editor.settle();
		expect(editor.source()).toBe('one\n\ntwo\n\nthree\n');
		editor.instance.runCommand('history.redo');
		await editor.settle();
		expect(editor.source()).toBe('one\n\ntwX\n\nthree\n');
	});

	it('keeps the ids of the blocks it did not reach, and the first replaced one', async () => {
		const editor = await mounted('one\n\ntwo\n\nthree\n');
		const surface = editor.instance.__test;
		const before = [...surface.getBlockIds()];
		await surface.spliceSource('one\n\ntwo\nmore\n\n# new\n\nthree\n', text(13), OP);
		const after = surface.getBlockIds();
		expect(after).toHaveLength(4);
		expect([after[0], after[1], after[3]]).toEqual(before);
		expect(before).not.toContain(after[2]);
	});

	it('puts a text caret at its byte, inside a container too', async () => {
		const editor = await mounted('para\n\n> quoted line\n');
		await editor.instance.__test.spliceSource('para\n\n> quoted LINE\n', text(16), OP);
		await editor.settle();
		const point = { path: [1, 0], offset: 8 };
		expect(editor.instance.getSelection()).toEqual({ anchor: point, focus: point });
	});

	it('focuses a block held whole on its first byte', async () => {
		const editor = await mounted('a\n\n---\n\nb\n');
		await editor.instance.__test.spliceSource(
			'ax\n\n---\n\nb\n',
			{ at: 4, holds: 'block', parent: [] },
			OP
		);
		await editor.settle();
		expect(editor.instance.getSelection()?.focus.path).toEqual([1]);
	});

	it('puts a boundary caret between two blocks no text holds', async () => {
		const table = '| a |\n| - |\n| 1 |\n';
		const fence = '```\nx\n```\n';
		const editor = await mounted(`${table}\nmiddle\n\n${fence}`);
		await editor.instance.__test.spliceSource(
			`${table}\n${fence}`,
			{
				at: table.length + 1,
				holds: 'boundary',
				parent: []
			},
			OP
		);
		await editor.settle();
		expect(editor.instance.__test.getGapCaret()).toEqual({ parentPath: [], index: 1 });
	});

	// Miss-analysis: every commit test's opener and closer sat in one window.
	it('reads a closer typed far below the opener it finishes', async () => {
		const editor = await mounted(':::note\na\n\nb\n\nc\n');
		await editor.instance.__test.spliceSource(':::note\na\n\nb\n\nc\n:::\n', text(19), OP);
		const kinds = editor.instance.__test.getDocument().children.map((n) => n.kind);
		expect(kinds).toEqual(['admonition']);
	});

	// Miss-analysis: the commit's own tests landed carets only; the range replay found the stale range.
	it('ends a range it replaces, which named the blocks before it', async () => {
		const editor = await mounted('x\n# h\n| A | B |\n| - | - |\n');
		const range = { anchor: { path: [0], offset: 1 }, focus: { path: [1], offset: 3 } };
		// Resolves false in jsdom even once placed, since its scroll never arrives.
		await editor.instance.setSelection(range);
		await editor.settle();
		await editor.instance.__test.spliceSource('x\n\n| A | B |\n| - | - |\n', text(1), OP);
		await editor.settle();
		const point = { path: [0], offset: 1 };
		expect(editor.instance.getSelection()).toEqual({ anchor: point, focus: point });
	});

	// Miss-analysis: the read-back check had never met an emptied document's byteless paragraph.
	it('empties a document to one paragraph with no bytes', async () => {
		const editor = await mounted('a\n\nb\n');
		await editor.instance.__test.spliceSource('', text(0), OP);
		expect(editor.source()).toBe('');
		expect(editor.instance.__test.getDocument().children).toHaveLength(1);
	});

	it('writes nothing for the bytes it already holds', async () => {
		const editor = await mounted('one\n');
		expect(await editor.instance.__test.spliceSource('one\n', text(1), OP)).toBe(false);
		expect(editor.instance.__test.getUndoStack().undo).toHaveLength(0);
	});

	it('is refused in reading mode', async () => {
		const editor = await mounted('one\n', 'reading');
		expect(await editor.instance.__test.spliceSource('two\n', text(1), OP)).toBe(false);
		expect(editor.source()).toBe('one\n');
		takeDevWarns();
	});
});

describe('a byte splice in an undo step', () => {
	it('joins the step, so two splices undo as one', async () => {
		const harness = makeEditorActionsDeps('a\n\nb\n');
		const controller = createUndoController(harness.deps);
		const splice = (from: number, insert: string) =>
			controller.commitSource({
				changes: [{ from, to: from + 1, insert }],
				caret: text(from),
				op: OP,
				snapshot: { path: docPathFrom([0]), offset: 0 }
			});
		await controller.undoStep({ path: docPathFrom([0]), offset: 0 }, async () => {
			await splice(0, 'A');
			await splice(3, 'B');
		});
		expect(serialize(harness.deps.doc)).toBe('A\n\nB\n');
		expect(harness.deps.undoManager.getStacks().undo).toHaveLength(1);
	});

	// Miss-analysis: the only no-op tested came through `changesBetween`, which drops equal bytes.
	it('writes nothing for a change list that leaves the bytes as they are', async () => {
		const harness = makeEditorActionsDeps('a\n\nb\n');
		const controller = createUndoController(harness.deps);
		const wrote = await controller.commitSource({
			changes: [{ from: 0, to: 1, insert: 'a' }],
			caret: text(0),
			op: OP,
			snapshot: { path: docPathFrom([0]), offset: 0 }
		});
		expect(wrote).toBe(false);
		expect(harness.deps.undoManager.getStacks().undo).toHaveLength(0);
	});

	it('rolls back its blocks and ids when the write throws', async () => {
		const harness = makeEditorActionsDeps('a\n\nb\n');
		const controller = createUndoController(harness.deps);
		const ids = [...harness.deps.blockIds];
		harness.deps.setBlockIds = () => {
			throw new Error('boom');
		};
		const write = controller.commitSource({
			changes: [{ from: 0, to: 1, insert: 'A' }],
			caret: text(0),
			op: OP,
			snapshot: { path: docPathFrom([0]), offset: 0 }
		});
		await expect(write).rejects.toThrow('boom');
		expect(serialize(harness.deps.doc)).toBe('a\n\nb\n');
		expect(harness.deps.blockIds).toEqual(ids);
		expect(harness.deps.undoManager.getStacks().undo).toHaveLength(0);
		takeDevWarns();
	});
});
