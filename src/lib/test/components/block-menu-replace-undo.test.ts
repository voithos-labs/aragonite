// @vitest-environment jsdom
// A block menu row that rewrites the block right after typing in it is its own undo step, and its
// bytes are no keystroke's.
// Miss-analysis: every menu test picked a row on an untouched document, never inside a burst.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRootMenus, type BlockMenuModel } from '$lib/components/editor-root-menus';
import { serialize } from '$lib/core/serializer';
import { replaceBlockRaw } from '$lib/editor-actions/block-edit-core';
import { createHistoryActions } from '$lib/editor-actions/commit/history';
import type { EditEvent } from '$lib/editor-events';
import { registerBuiltinBlockContextActions } from '$lib/schema/context-actions';
import { everyInstalledPlugin } from '$lib/schema/plugin-activation';
import { fixtureReading } from '../harness/fixture-grammar';
import { makeTopHarness } from '../harness/editor-actions';
import { settleEditor } from '../harness/settle';

const TYPED = '```\ncodex\n```\n';
const REWRITTEN = '```\nother\n```\n';

beforeAll(() => {
	registerBuiltinBlockContextActions('fencedCode', 'test-rewrite', () => [
		{ id: 'test.rewrite', label: 'Rewrite', run: (ctx) => ctx.replaceRaw(REWRITTEN) }
	]);
});

beforeEach(() => {
	vi.useFakeTimers();
	document.body.replaceChildren();
});

afterEach(() => {
	vi.useRealTimers();
});

/** Types one character into the fence's body, then picks the rewrite row before the pause. */
async function typeThenRewrite() {
	const editor = makeTopHarness('```\ncode\n```\n');
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
		replaceRaw: (index, raw) =>
			replaceBlockRaw({ deps: editor.deps, controller: editor.controller }, [index], raw),
		placeCaretAtPoint: () => true,
		insertMarkdown: async () => true,
		insertCatalogue: () => [],
		activation: everyInstalledPlugin,
		reading: fixtureReading(),
		setMenu: (next) => (menu = next)
	});
	root.addEventListener('contextmenu', menus.onRootContextMenu);

	await editor.actions.updateBlockContent(0, TYPED, 'authored', 8, 9);
	fence.firstElementChild!.dispatchEvent(
		new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
	);
	menu!.pick('test.rewrite');
	await settleEditor();
	return editor;
}

describe('a block menu rewrite inside a typing burst', () => {
	it('one Ctrl+Z takes back the rewrite alone', async () => {
		const editor = await typeThenRewrite();
		expect(serialize(editor.doc)).toBe(REWRITTEN);

		await createHistoryActions(editor.deps, editor.controller).requestUndo();

		expect(serialize(editor.doc)).toBe(TYPED);
	});

	it('reports only the typed write as input', async () => {
		const editor = await typeThenRewrite();
		await vi.runAllTimersAsync();

		const inputs = editor.edits.filter(
			(e): e is Extract<EditEvent, { op: 'input' }> => e.op === 'input'
		);
		expect(inputs.map((e) => e.detail.byteLength)).toEqual([TYPED.length]);
	});
});
