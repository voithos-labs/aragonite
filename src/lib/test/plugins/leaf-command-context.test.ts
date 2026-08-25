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

const GATES = {
	history: { requestUndo() {}, requestRedo() {} },
	getPresentationMode: () => 'source' as const,
	isCrossBlockRange: () => false,
	crossBlockCommands: undefined
};

type BuildArgs = Parameters<typeof buildLeafCommandContext>;
type CtxOverrides = Partial<Omit<BuildArgs[0], 'getIndex'> & BuildArgs[1]> & {
	index?: number;
	pluginEditor?: BuildArgs[2];
};

// getNode stays a thunk through the builder: the dispatch re-reads it, so capturing what
// it returned would hide the node swap the liveness case below relies on.
function buildCtx(over: CtxOverrides = {}) {
	const {
		getNode = () => leafNode(),
		index = 0,
		commandHooks,
		updateBlockMetadata = vi.fn()
	} = over;
	return buildLeafCommandContext(
		{ getNode, getIndex: () => index, commandHooks },
		{ updateBlockMetadata },
		over.pluginEditor
	);
}

afterEach(() => {
	__resetCommandWarningsForTests();
	__resetBlockCommandsForTests();
	__resetInstalledPluginsForTests();
});

describe('editable-leaf command context', () => {
	it('routes updateMetadata to blockEdit.updateBlockMetadata at the live index', () => {
		const updateBlockMetadata = vi.fn();
		const ctx = buildCtx({ index: 3, updateBlockMetadata });

		ctx.updateMetadata({ code: 'x' });
		expect(updateBlockMetadata).toHaveBeenCalledWith(3, { code: 'x' });
	});

	it('threads commandHooks so a handler reaches the component; absent → undefined', () => {
		const hooks = { openEdit: vi.fn() };
		expect(buildCtx({ commandHooks: () => hooks }).hooks).toBe(hooks);
		expect(buildCtx().hooks).toBeUndefined();
	});

	it('reads getNode() live so a node swap is observed (thunks, never values)', () => {
		let node = leafNode();
		const build = () => buildCtx({ getNode: () => node });

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

		const ctx = buildCtx({ pluginEditor });

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
			getCommandContext: () => buildCtx({ getNode: () => node, commandHooks: () => hooks })
		};

		const handled = dispatchKeyCommand('Mod+Shift+K', target, GATES, overrides);
		expect(handled).toBe(true);
		expect(hooks.openFocusView).toHaveBeenCalledTimes(1);
	});
});
