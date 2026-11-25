// @vitest-environment jsdom
// A line block drawn by a Svelte component through `svelteBlock`: its `<Slot>` holds the editor's
// text element by the time `draw` returns, the component follows each edit, and what it declares
// with `useDrawn` reaches the editor.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { fencedBlock } from '#lib/components/block-makers/fenced-block.js';
import { command } from '#lib/schema/plugin-command.js';
import type { Block } from '#lib/schema/doc-view.js';
import { svelteBlock } from '#lib/components/drawn-block/svelte-block.svelte.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto,
	type BlockLookup
} from '#lib/test/harness/mount-editor.svelte.js';
import SlottedNote from '../fixtures/SlottedNote.svelte';
import DrawnDie from '../fixtures/DrawnDie.svelte';
import SavedField from '../fixtures/SavedField.svelte';

beforeEach(installLayoutStubs);
afterEach(async () => {
	await destroyMountedEditors();
	document.body.innerHTML = '';
});

const SOURCE = 'intro\n\n%%note abcd\n\noutro\n';
const NOTE = [1];

const notes = definePlugin({
	name: 'notes',
	version: '1.0.0',
	editor: '*',
	contributes: () => ({
		blocks: [
			lineBlock({
				name: 'note',
				label: 'Note',
				match: /^%%note(?: (?<text>.*))?$/,
				sample: '%%note hi',
				insert: { none: 'a test block type' },
				edit: 'text',
				draw: svelteBlock(SlottedNote)
			}),
			lineBlock({
				name: 'die',
				label: 'Die',
				match: /^!! .*$/,
				sample: '!! d6',
				insert: { none: 'a test block type' },
				edit: 'box',
				draw: svelteBlock(DrawnDie)
			})
		]
	})
});

describe('svelteBlock', () => {
	it("holds the editor's text element in its slot, beside the component's own markup", async () => {
		const editor = mountEditor({ source: SOURCE, plugins: [notes] });
		await editor.settle();
		const host = blockHostAt(editor, NOTE);
		expect(host.querySelector('.caption')?.textContent).toBe('abcd');
		expect(
			host.querySelector('div[style="display: contents"]')?.contains(surfaceAt(editor, NOTE))
		).toBe(true);
		expect(takeDevWarns()).toEqual([]);
	});

	it("puts `className` on the block's element, as `reactBlock` and `vueBlock` do", async () => {
		const framed = definePlugin({
			name: 'framed',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					lineBlock({
						name: 'note',
						label: 'Note',
						match: /^%%note(?: (?<text>.*))?$/,
						sample: '%%note hi',
						insert: { none: 'a test block type' },
						edit: 'text',
						draw: svelteBlock(SlottedNote, { className: 'note-frame wide' })
					})
				]
			})
		});
		const editor = mountEditor({ source: SOURCE, plugins: [framed] });
		await editor.settle();
		const frame = blockHostAt(editor, NOTE).querySelector('.note-frame.wide');
		expect(frame?.querySelector('.caption')?.textContent).toBe('abcd');
	});

	it('renders the component again on each edit', async () => {
		const editor = mountEditor({ source: SOURCE, plugins: [notes] });
		await editor.settle();
		typeInto(surfaceAt(editor, NOTE), '%%note abcdX');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcdX'));
		expect(blockHostAt(editor, NOTE).querySelector('.caption')?.textContent).toBe('abcdX');
	});

	it('hands the caret to the focus its component declares with `useDrawn`', async () => {
		const editor = mountEditor<BlockLookup>({ source: 'intro\n\n!! d6\n', plugins: [notes] });
		await editor.settle();
		editor.instance.__test.getBlockComponent([1]).focus?.(0);
		await editor.settle();
		expect(document.activeElement).toBe(blockHostAt(editor, [1]).querySelector('.die'));
	});

	// Miss-analysis: the wrapper's `save` and `handle` getters were added with no component declaring
	// either, so deleting them left every suite green.
	it('hands the editor the `save` and `handle` its component declares with `useDrawn`', async () => {
		const handed: unknown[] = [];
		const focusField = command<Block<never>, { focus(): void }>({
			id: 'focus-field',
			title: 'Focus the field',
			run: (_editor, _block, field) => {
				handed.push(field);
				field?.focus();
			}
		});
		const saved = definePlugin({
			name: 'saved',
			version: '1.0.0',
			editor: '*',
			contributes: () => ({
				blocks: [
					fencedBlock({
						name: 'field',
						label: 'Field',
						fence: { info: 'field' },
						sample: '```field\nx\n```',
						insert: { none: 'a test block type' },
						actions: [{ label: 'Focus', command: focusField }],
						edit: 'box',
						draw: svelteBlock(SavedField)
					})
				]
			})
		});
		const editor = mountEditor({ source: '```field\nfirst\n```\n', plugins: [saved] });
		await editor.settle();
		const field = () => editor.target.querySelector<HTMLTextAreaElement>('.saved-field')!;
		field().value = 'typed';
		editor.instance.runCommand('history.undo');
		await editor.settle();
		editor.instance.runCommand('history.redo');
		await editor.settle();
		expect(editor.source()).toBe('```field\ntyped\n```\n');
		expect(editor.instance.run(focusField, editor.instance.doc.blocks[0])).toBe(true);
		expect(handed).toHaveLength(1);
		expect(document.activeElement).toBe(field());
	});
});
