// @vitest-environment jsdom
// Miss-analysis: no row held a box's unwritten text across an undo, a redo, a mode change or a new
// document, since the only box with one (mermaid's) saved through a draft of its own, untested here.
// `Drawn.save`: the editor saves a box's unwritten text before an undo, a redo or a mode change, as
// one step that undo then takes back, and drops it when a new document comes in.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import type { Block } from '#lib/schema/doc-view.js';
import type { BoxDrawContext } from '#lib/schema/drawing.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	type MountedEditor
} from '#lib/test/harness/mount-editor.svelte.js';
import { takeDevWarnsOf } from '#lib/test/support/warn-gate.js';

type Surface = { getUndoStack(): { undo: unknown[]; redo: unknown[] } };

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

/** How the box's save writes: inside the call, or after a wait; and how often it was asked. */
let late = false;
let asked = 0;

// A field over the fence's body, written by `save`; the bytes changing under it show in it.
function drawBox(block: Block<never>, ctx: BoxDrawContext) {
	const dom = document.createElement('div');
	const field = document.createElement('textarea');
	dom.append(field);
	let current = block;
	let shown = block.body;
	field.value = shown;
	return {
		dom,
		update(next: Block<never>) {
			current = next;
			if (next.body !== shown) field.value = shown = next.body;
		},
		save() {
			asked++;
			if (field.value === shown) return;
			shown = field.value;
			const draft = ctx.editor.edit().body(current, field.value);
			if (late) void Promise.resolve().then(() => draft.commit());
			else void draft.commit();
		}
	};
}

const boxes = definePlugin({
	name: 'boxes',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			fencedBlock({
				name: 'box',
				label: 'Box',
				fence: { info: 'box' },
				sample: '```box\nx\n```',
				insert: { none: 'a test block type' },
				edit: 'box',
				draw: drawBox
			})
		]
	})
});

const SOURCE = 'Above\n\n```box\nfirst\n```\n';

async function mounted(): Promise<MountedEditor<Surface>> {
	late = false;
	asked = 0;
	const editor = mountEditor<Surface>({ source: SOURCE, plugins: [boxes] });
	await editor.settle();
	// One step under the box's text: a letter typed above it.
	const above = surfaceAt(editor, [0]);
	above.textContent = 'Above!';
	above.dispatchEvent(new InputEvent('input', { bubbles: true }));
	await editor.settle();
	return editor;
}

const typeInBox = (editor: MountedEditor, text: string) => {
	editor.target.querySelector('textarea')!.value = text;
};
const fieldOf = (editor: MountedEditor) => editor.target.querySelector('textarea')!.value;

async function run(editor: MountedEditor, id: string) {
	editor.instance.runCommand(id);
	await editor.settle();
}

describe("a box's unwritten text", () => {
	it('is saved by an undo and taken back by it, so a redo writes it', async () => {
		const editor = await mounted();
		typeInBox(editor, 'typed');
		await run(editor, 'history.undo');
		expect(editor.source()).toBe('Above!\n\n```box\nfirst\n```\n');
		expect(fieldOf(editor)).toBe('first');
		await run(editor, 'history.redo');
		expect(editor.source()).toBe('Above!\n\n```box\ntyped\n```\n');
		await run(editor, 'history.undo');
		await run(editor, 'history.undo');
		expect(editor.source()).toBe(SOURCE);
	});

	it('is saved before a redo, which then has nothing left to redo', async () => {
		const editor = await mounted();
		await run(editor, 'history.undo');
		typeInBox(editor, 'typed');
		await run(editor, 'history.redo');
		expect(editor.source()).toBe('Above\n\n```box\ntyped\n```\n');
		expect(editor.instance.__test.getUndoStack().redo).toHaveLength(0);
	});

	it('is written by a mode change, as one undo step', async () => {
		const editor = await mounted();
		typeInBox(editor, 'typed');
		editor.props.presentationMode = 'live';
		await editor.settle();
		expect(editor.source()).toBe('Above!\n\n```box\ntyped\n```\n');
		await run(editor, 'history.undo');
		expect(editor.source()).toBe('Above!\n\n```box\nfirst\n```\n');
	});

	it('is dropped by a new document, which nothing writes into', async () => {
		const editor = await mounted();
		typeInBox(editor, 'typed');
		editor.props.source = 'Other\n';
		await editor.settle();
		expect(editor.source()).toBe('Other\n');
		expect(asked).toBe(0);
	});

	it('written after the save returned, is named in a dev build and never lands in the undo', async () => {
		const editor = await mounted();
		late = true;
		typeInBox(editor, 'typed');
		await run(editor, 'history.undo');
		expect(takeDevWarnsOf('invariant:save-before-swap')).toHaveLength(1);
		expect(editor.source()).not.toContain('typed');
	});
});
