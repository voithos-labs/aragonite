// @vitest-environment jsdom
// Miss-analysis: a container's chords ran only from its own keydown handler, so a container that
// bound none lost them, and every suite's container bound one.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineBlockView, definePlugin } from '#lib/plugin.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { registerMermaidKind } from '#lib/plugins/mermaid/mermaid-kind.js';
import { pressKey } from '#lib/test/harness/settle.js';
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
import {
	expectFocusAgrees,
	expectParity,
	probe,
	type ClaimContext
} from '../editor-root/claims-parity';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import KeylessContainerBlock from '../plugins/fixtures/KeylessContainerBlock.svelte';
import { createContainerChords } from '#lib/editor-actions/container-chords.js';
import { parse } from '#lib/core/parser.js';
import { commandContext } from '../harness/command-context';

beforeEach(installLayoutStubs);
afterEach(destroyMountedEditors);

const NOTE = ':::note\nbody\n:::\n';

function notePlugin(stops: boolean) {
	const view = svelteBlockView(KeylessContainerBlock, () => ({ stops }));
	return definePlugin({
		name: stops ? 'stopping-note' : 'keyless-note',
		setup: () => registerAdmonitions(view)
	});
}

const mountNote = (stops: boolean) => mountEditor({ source: NOTE, plugins: [notePlugin(stops)] });

// A diagram whose source box is always open and lets every key bubble, inside an admonition.
const DIAGRAM_IN_NOTE = ':::note\n\n```mermaid\ngraph TD\n```\n\n:::\n';
const DIAGRAM_PLUGINS = [
	admonitionsPlugin(),
	definePlugin({
		name: 'box-diagram',
		setup: () =>
			registerMermaidKind(
				defineBlockView({
					surface: 'container',
					mount(target, ctx) {
						const box = document.createElement('textarea');
						box.className = 'diagram-source';
						target.append(box);
						ctx.container.attachFocus(box);
						return {};
					}
				})
			)
	})
];

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

	// The editor root asks this before reading where a key landed, on every key in the document.
	it('is ruled out for a letter before anything reads where the key landed', () => {
		const chords = createContainerChords({
			commands: commandContext(),
			getBlockComponent: () => null,
			selection: { isCrossBlock: false, anchor: null, focus: null },
			getDoc: () => parse('')
		});
		expect(chords.mayTake(new KeyboardEvent('keydown', { key: 'x' }))).toBe(false);
		expect(chords.mayTake(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))).toBe(true);
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

// Miss-analysis: every container-chord row pressed its key in a leaf, never in the container's own
// control, a plugin's own editor inside it, or a built-in block's button inside a list item.
describe('a container chord pressed outside any block inside the container', () => {
	it('runs from the container’s own button', async () => {
		const editor = mountNote(true);
		await editor.settle();
		const button = editor.target.querySelector<HTMLElement>('.container-chrome')!;
		button.focus();
		const event = await pressKey(button, { key: '7', ctrlKey: true });
		expect([editor.source(), event.defaultPrevented]).toEqual([':::tip\nbody\n:::\n', true]);
	});

	it('never runs from a plugin’s own editor inside it', async () => {
		const editor = mountEditor({ source: DIAGRAM_IN_NOTE, plugins: DIAGRAM_PLUGINS });
		await editor.settle();
		const box = editor.target.querySelector<HTMLElement>('textarea.diagram-source')!;
		box.focus();
		await pressKey(box, { key: '7', ctrlKey: true });
		expect(editor.source()).toBe(DIAGRAM_IN_NOTE);
	});
});

const focusOn =
	(selector: string): ClaimContext['enter'] =>
	async (editor) => {
		const el = editor.target.querySelector<HTMLElement>(selector);
		if (!el) throw new Error(`nothing matches ${selector}`);
		el.focus();
		return el;
	};

// A plugin's own editor is claimed Enter, Tab and Escape whatever it does with them, so its row
// asks only the chords a container could take from it.
const OFF_LEAF: (ClaimContext & { keys: string[] })[] = [
	{
		name: 'the container’s own button',
		source: NOTE,
		plugins: [notePlugin(true)],
		focus: { at: 'control', path: [0] },
		enter: focusOn('.container-chrome'),
		keys: ['Mod+7', 'Tab', 'Mod+Z', 'A']
	},
	{
		name: 'a plugin’s own editor inside a container',
		source: DIAGRAM_IN_NOTE,
		plugins: DIAGRAM_PLUGINS,
		focus: { at: 'plugin-editor', path: [0, 1] },
		enter: focusOn('textarea.diagram-source'),
		keys: ['Mod+7', 'Mod+Z', 'A']
	},
	{
		name: 'a table’s button in a task item',
		source: '- [ ] one\n- [ ] two\n\n  | A |\n  | - |\n  | 1 |\n',
		focus: { at: 'control' },
		enter: focusOn('button[class*="table"]'),
		keys: ['Tab', 'Shift+Tab', 'Mod+Enter', 'Mod+Z', 'A']
	}
];

describe.each(OFF_LEAF)('claimsChord agrees with the keydown: $name', (context) => {
	it('reads the focus its handler stands at', () => expectFocusAgrees(context));
	it.each(context.keys)('%s', (chord) => expectParity(context, chord));
});
