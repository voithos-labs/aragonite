// @vitest-environment jsdom
// A block menu row writes through a draft opened at the pick: right after typing it's its own undo
// step, and an edit to the block while a clipboard read waits refuses it.
// Miss-analysis: every menu test picked a row on an untouched document, never inside a burst.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRootMenus, type BlockMenuModel } from '#lib/components/editor-root/menus.js';
import { createSelectionState } from '#lib/selection/selection-state.svelte.js';
import { serialize } from '#lib/core/serializer.js';
import { createHistoryActions } from '#lib/editor-actions/commit/history.js';
import { createDraftRegistry } from '#lib/editor-actions/commit/draft-registry.svelte.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { fixtureReading } from '../harness/fixture-grammar';
import { makeTopHarness } from '../harness/editor-actions';
import { settleEditor } from '../harness/settle';
import { noSelectionActions } from '#lib/test/harness/no-selection-actions.js';

const TYPED = '```\ncodex\n```\n';

beforeEach(() => {
	vi.useFakeTimers();
	document.body.replaceChildren();
});

afterEach(() => {
	vi.useRealTimers();
});

/** A fence's block menu over a harness whose commits tell a real draft registry what changed. */
function fenceMenu(source: string) {
	const editor = makeTopHarness(source);
	const drafts = createDraftRegistry({
		stamps: editor.deps.stamps,
		doc: () => editor.doc,
		isReading: () => false,
		isOn: () => true,
		writes: () => ({
			commitSource: editor.controller.commitSource,
			undoStep: (seed, run) => editor.controller.undoStep(seed, run),
			insert: async () => false
		})
	});
	editor.deps.drafts = drafts;
	const root = document.createElement('div');
	const fence = document.createElement('div');
	fence.className = 'block-host';
	fence.setAttribute('data-block-path', '[0]');
	fence.append(document.createElement('pre'));
	root.append(fence);
	document.body.append(root);
	let menu: BlockMenuModel | null = null;
	const menus = createRootMenus({
		get editorEl() {
			return root;
		},
		mode: 'source',
		getDoc: () => editor.doc,
		isHostChrome: () => false,
		blockEdit: editor.actions,
		openDraft: (spec, path) => drafts.open(spec, path),
		placeMenuCaret: () => true,
		rangeAtContextPress: () => false,
		selection: createSelectionState(),
		finger: () => false,
		insertMarkdown: async () => true,
		clipboard: { take: () => null, pasteTarget: () => null },
		inserts: () => [],
		activation: everyInstalledPlugin,
		reading: fixtureReading(),
		stamps: editor.deps.stamps,
		canEditLinkAtCaret: () => false,
		editLinkAtCaret: () => {},
		setMenu: (next) => (menu = next),
		currentMenu: () => menu,
		actions: noSelectionActions
	});
	root.addEventListener('contextmenu', menus.onRootContextMenu);
	const pick = (id: string) => {
		fence.firstElementChild!.dispatchEvent(
			new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
		);
		menu!.pick(id);
	};
	return { editor, pick };
}

/** Types one character into the fence's body, then dissolves it before the pause. */
async function typeThenDissolve() {
	const { editor, pick } = fenceMenu('```\ncode\n```\n');
	await editor.actions.updateBlockContent(0, TYPED, 'authored', 'join-typing', 8, 9);
	pick('code.dissolve');
	await settleEditor();
	return editor;
}

describe('a block menu rewrite inside a typing burst', () => {
	it('one Ctrl+Z takes back the rewrite alone', async () => {
		const editor = await typeThenDissolve();
		expect(serialize(editor.doc)).toBe('codex\n');

		await createHistoryActions(editor.deps, editor.controller).requestUndo();

		expect(serialize(editor.doc)).toBe(TYPED);
	});

	it('reports only the typed write as input', async () => {
		const editor = await typeThenDissolve();
		await vi.runAllTimersAsync();

		expect(editor.edits.filter((e) => e.op === 'input').map((e) => e.path)).toEqual([[0]]);
	});
});

describe('"Replace with clipboard" while the clipboard read waits', () => {
	// Miss-analysis: the row wrote by block index after the read, so an edit in between was overwritten.
	it('writes nothing over an edit made to the block in the meantime', async () => {
		let release: (text: string) => void = () => {};
		Object.defineProperty(navigator, 'clipboard', {
			value: { readText: () => new Promise<string>((resolve) => (release = resolve)) },
			configurable: true
		});
		const { editor, pick } = fenceMenu('```\ncode\n```\n');
		pick('block.replace');
		await editor.actions.updateBlockContent(0, TYPED, 'authored', 'join-typing', 8, 9);
		release('pasted\n');
		await settleEditor();

		expect(serialize(editor.doc)).toBe(TYPED);
	});

	it('writes the clipboard when nothing moved', async () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: { readText: async () => 'pasted\n' },
			configurable: true
		});
		const { editor, pick } = fenceMenu('```\ncode\n```\n\nafter\n');
		pick('block.replace');
		await settleEditor();

		expect(serialize(editor.doc)).toBe('pasted\n\nafter\n');
	});
});
