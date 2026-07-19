import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	dispatchKeyCommand,
	registerBlockCommand,
	__resetBlockCommandsForTests
} from '$lib/schema/block-commands';
import { __resetCommandWarningsForTests } from '$lib/schema/commands';
import { normalizeChordStrict } from '$lib/schema/keybindings';
import type { KeybindingOverrideMap } from '$lib/schema/keybinding-overrides';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	recordPluginKindOwner,
	__resetInstalledPluginsForTests,
	type EditorContext
} from '$lib/schema/plugin-install';
import { buildLeafCommandContext } from '$lib/components/blocks/editable-leaf';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';
import type { AnyCommandId } from '$lib/schema/command-id';

// Branded plugin kinds, declared once at module scope (the reset clears commands,
// not kind declarations; a per-test declare would double-throw).
const leaf = declarePluginKind('demoLeaf');
const leafAlt = declarePluginKind('demoLeafAlt');

const leafNode = (kind: AnyBlockKind = leaf): CstNode =>
	({ kind, leadingTrivia: '', raw: '' }) as CstNode;

function bindKindChord(
	kind: AnyBlockKind,
	chord: string,
	command: AnyCommandId
): KeybindingOverrideMap {
	const normalized = normalizeChordStrict(chord);
	if (normalized === null) throw new Error(`unexpected chord normalization for "${chord}"`);
	return {
		global: new Map(),
		byKind: new Map([[kind, new Map([[normalized, { chord: normalized, command }]])]])
	};
}

const history = { history: { requestUndo() {}, requestRedo() {} } };

afterEach(() => {
	__resetCommandWarningsForTests();
	__resetBlockCommandsForTests();
	__resetInstalledPluginsForTests();
});

describe('editable-leaf command context', () => {
	it('routes updateMetadata to blockEdit.updateBlockMetadata at the live index', () => {
		const updateBlockMetadata = vi.fn();
		const index = 3;
		const ctx = buildLeafCommandContext(
			{
				getNode: () => leafNode(),
				getIndex: () => index,
				commandHooks: undefined
			},
			{ updateBlockMetadata }
		);

		ctx.updateMetadata({ code: 'x' });
		expect(updateBlockMetadata).toHaveBeenCalledWith(3, { code: 'x' });
	});

	it('threads commandHooks so a handler reaches the component; absent → undefined', () => {
		const hooks = { openEdit: vi.fn() };
		const withHooks = buildLeafCommandContext(
			{
				getNode: () => leafNode(),
				getIndex: () => 0,
				commandHooks: () => hooks
			},
			{ updateBlockMetadata: vi.fn() }
		);
		expect(withHooks.hooks).toBe(hooks);

		const without = buildLeafCommandContext(
			{
				getNode: () => leafNode(),
				getIndex: () => 0,
				commandHooks: undefined
			},
			{ updateBlockMetadata: vi.fn() }
		);
		expect(without.hooks).toBeUndefined();
	});

	it('reads getNode() live so a node swap is observed (thunks, never values)', () => {
		let node = leafNode();
		const build = () =>
			buildLeafCommandContext(
				{
					getNode: () => node,
					getIndex: () => 0,
					commandHooks: undefined
				},
				{ updateBlockMetadata: vi.fn() }
			);

		expect(build().node).toBe(node);
		node = leafNode(leafAlt);
		expect(build().node.kind).toBe(leafAlt);
	});

	it("exposes the owning plugin's EditorContext as ctx.editor, keyed by pluginKindOwner", () => {
		const fakeEditorContext = { editorId: 'e1' } as unknown as EditorContext;
		recordPluginKindOwner(leaf, 'admonitions');
		const pluginEditor = vi.fn((name: string) =>
			name === 'admonitions' ? fakeEditorContext : ({} as EditorContext)
		);

		const ctx = buildLeafCommandContext(
			{
				getNode: () => leafNode(),
				getIndex: () => 0,
				commandHooks: undefined
			},
			{ updateBlockMetadata: vi.fn() },
			pluginEditor
		);

		expect(ctx.editor).toBe(fakeEditorContext);
		expect(pluginEditor).toHaveBeenCalledWith('admonitions');
	});

	// The leaf tier reaches a minted handler through the same dispatch seam as the
	// container tier: a chord on the focused leaf resolves the registered command
	// and hands it the leaf's command context, hooks included.
	it('dispatches a minted command on the leaf path with hooks reaching the handler', () => {
		const hooks = { openFocusView: vi.fn() };
		const handler = vi.fn((ctx: { hooks?: unknown }) => {
			(ctx.hooks as { openFocusView(): void } | undefined)?.openFocusView();
			return true;
		});
		const id = registerBlockCommand(leaf, 'leaf.focus', handler);
		const overrides = bindKindChord(leaf, 'Mod+Shift+K', id);
		const node = leafNode();
		const target = {
			kind: leaf,
			runCommand: () => false,
			getCommandContext: () =>
				buildLeafCommandContext(
					{
						getNode: () => node,
						getIndex: () => 0,
						commandHooks: () => hooks
					},
					{ updateBlockMetadata: vi.fn() }
				)
		};

		const handled = dispatchKeyCommand('Mod+Shift+K', target, history, overrides);
		expect(handled).toBe(true);
		expect(hooks.openFocusView).toHaveBeenCalledTimes(1);
	});
});
