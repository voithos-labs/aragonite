// @vitest-environment jsdom
// A line block drawn by a Svelte component through `svelteBlock`: its `<Slot>` holds the editor's
// text element by the time `draw` returns, and the component follows each edit.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/schema/plugin-install.js';
import { lineBlock } from '#lib/components/block-makers/line-block.js';
import { svelteBlock } from '#lib/components/drawn-block/svelte-block.svelte.js';
import { takeDevWarns } from '#lib/test/support/warn-gate.js';
import {
	blockHostAt,
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	surfaceAt,
	typeInto
} from '#lib/test/harness/mount-editor.svelte.js';
import SlottedNote from '../fixtures/SlottedNote.svelte';

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

	it('renders the component again on each edit', async () => {
		const editor = mountEditor({ source: SOURCE, plugins: [notes] });
		await editor.settle();
		typeInto(surfaceAt(editor, NOTE), '%%note abcdX');
		await editor.settle();
		expect(editor.source()).toBe(SOURCE.replace('abcd', 'abcdX'));
		expect(blockHostAt(editor, NOTE).querySelector('.caption')?.textContent).toBe('abcdX');
	});
});
