import { describe, it, expect, vi, afterEach } from 'vitest';
import { dispatchKeyCommand, registerBlockCommand } from '$lib/schema/block-commands';
import { normalizeChordStrict } from '$lib/schema/keybindings';
import type { KeybindingOverrideMap } from '$lib/schema/keybinding-overrides';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { buildLeafCommandContext } from '$lib/components/blocks/editable-leaf';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';
import type { AnyCommandId } from '$lib/schema/command-id';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { commandContextWith } from '$lib/test/support/command-context';

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

type BuildArgs = Parameters<typeof buildLeafCommandContext>;
type CtxOverrides = Partial<Omit<BuildArgs[0], 'getIndex'> & BuildArgs[1]> & {
	index?: number;
};

// `getNode` stays a function through the builder: the dispatch re-reads it, so capturing what
// it returned would hide the node swap the case below relies on.
function buildCtx(over: CtxOverrides = {}) {
	const {
		getNode = () => leafNode(),
		index = 0,
		commandHooks,
		updateBlockMetadata = vi.fn()
	} = over;
	return buildLeafCommandContext(
		{ getNode, getIndex: () => index, commandHooks },
		{ updateBlockMetadata }
	);
}

afterEach(() => __resetSchemaRegistriesForTests());

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

	// A key combination on a focused leaf resolves the registered command through the same
	// dispatch a container uses, and hands it the block's command context, hooks included.
	it('dispatches a created command on the leaf path with hooks reaching the handler', () => {
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

		const handled = dispatchKeyCommand('Mod+Shift+K', target, commandContextWith(overrides));
		expect(handled).toBe(true);
		expect(hooks.openFocusView).toHaveBeenCalledTimes(1);
	});
});
