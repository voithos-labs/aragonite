// @vitest-environment jsdom
// Miss-analysis: a container's chords ran only from its own keydown handler, so a container that
// bound none lost them, and every suite's container bound one.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { definePlugin } from '#lib/plugin.js';
import { svelteBlockView } from '#lib/svelte.js';
import { registerAdmonitions } from '#lib/plugins/admonitions/admonition-kind.js';
import {
	destroyMountedEditors,
	installLayoutStubs,
	mountEditor,
	placeCaret,
	pressKeyAt,
	surfaceAt
} from '#lib/test/harness/mount-editor.svelte.js';
import { probe, type ClaimContext } from '../editor-root/claims-parity';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import KeylessContainerBlock from '../plugins/fixtures/KeylessContainerBlock.svelte';

beforeEach(installLayoutStubs);
afterEach(destroyMountedEditors);

const NOTE = ':::note\nbody\n:::\n';

function mountNote(stops: boolean) {
	const view = svelteBlockView(KeylessContainerBlock, () => ({ stops }));
	const plugin = definePlugin({
		name: stops ? 'stopping-note' : 'keyless-note',
		setup: () => registerAdmonitions(view)
	});
	return mountEditor({ source: NOTE, plugins: [plugin] });
}

describe('a container’s kind chord pressed in a block inside it', () => {
	it.each([
		['binds no keydown', false],
		['stops every key it sees', true]
	])('runs once when the container %s', async (_, stops) => {
		const editor = mountNote(stops);
		await editor.settle();
		await pressKeyAt(editor, [0, 1], 2, { key: '7', ctrlKey: true });
		expect(editor.source()).toBe(':::tip\nbody\n:::\n');
	});
});

describe('a list item’s chords pressed in a nested item', () => {
	// A key the nested item declined is still that item's: the outer task must not toggle.
	it('toggle the nested task, never the task it sits in', async () => {
		const editor = mountEditor({ source: '- [ ] outer\n  - inner\n' });
		await editor.settle();
		await pressKeyAt(editor, [0, 0, 1, 0, 0], 2, { key: 'Enter', ctrlKey: true });
		expect(editor.source()).toBe('- [ ] outer\n  - inner\n');
	});

	it('run no chord the block already took', async () => {
		const editor = mountEditor({ source: '- one\n- two\n' });
		await editor.settle();
		const stop = (e: KeyboardEvent) => e.preventDefault();
		document.addEventListener('keydown', stop, { capture: true });
		await pressKeyAt(editor, [0, 1, 0], 1, { key: 'Tab' });
		document.removeEventListener('keydown', stop, { capture: true });
		expect(editor.source()).toBe('- one\n- two\n');
	});
});

// A count, not a time: the walk up a block's containers is skipped for a key no container binds.
describe('the container walk', () => {
	afterEach(disablePerfInstruments);

	it('never runs for a letter typed in a top-level paragraph', async () => {
		const editor = mountEditor({ source: 'para text\n' });
		await editor.settle();
		enablePerfInstruments();
		resetPerfInstruments();
		await pressKeyAt(editor, [0], 2, { key: 'x' });
		expect(perfSnapshot().containerChordWalks).toBe(0);
		await pressKeyAt(editor, [0], 2, { key: 'Tab', shiftKey: true });
		expect(perfSnapshot().containerChordWalks).toBe(1);
	});
});

// Miss-analysis: the step and its claim each composed the container lookup, and no row bound a
// container chord to a command the container has no way to run.
describe('a container chord bound to a command the container cannot run', () => {
	it('is neither claimed nor prevented', async () => {
		const context: ClaimContext = {
			name: 'quote, list.indent bound on the quote',
			source: '> quote text\n',
			keybindings: [{ kind: 'blockquote', chord: 'Mod+Shift+J', command: 'list.indent' }],
			enter: async (editor) => {
				const el = surfaceAt(editor, [0, 0]);
				placeCaret(el, 2);
				return el;
			}
		};
		const { claimed, prevented } = await probe(context, 'Mod+Shift+J');
		expect([claimed, prevented]).toEqual([false, false]);
	});
});
