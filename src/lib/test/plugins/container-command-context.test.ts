import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	dispatchKindCommand,
	registerBlockCommand,
	__resetBlockCommandsForTests
} from '$lib/schema/block-commands';
import { normalizeChordStrict } from '$lib/schema/keybindings';
import type { KeybindingOverrideMap } from '$lib/schema/keybinding-overrides';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import {
	recordPluginKindOwner,
	__resetInstalledPluginsForTests,
	type EditorContext
} from '$lib/schema/plugin-install';
import { buildContainerKindTarget } from '$lib/editor-actions/plugin/container';
import type { AnyBlockKind, CstNode } from '$lib/core/nodes';
import type { AnyCommandId } from '$lib/schema/command-id';

// No cross-block range in these cases; the seam's range decline has its own suite.
const GATES = {
	getPresentationMode: () => 'source' as const,
	isCrossBlockRange: () => false,
	crossBlockCommands: undefined
};

// Declared once at module scope: the reset clears the command registry, not the
// plugin-kind declarations, so a per-test declare would double-throw.
const note = declarePluginKind('demoNote');
const noteAlt = declarePluginKind('demoNoteAlt');

const noteNode = (kind = note): CstNode => ({ kind, leadingTrivia: '', raw: '' });

// The public `keybindings` prop types `kind` as a built-in BlockKind, so a plugin-kind
// binding goes in as its compiled map form — the shape a plugin's own keymap resolves
// through. This suite exercises only the target the container hands the dispatcher.
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

afterEach(() => {
	__resetBlockCommandsForTests();
	__resetInstalledPluginsForTests();
});

describe('plugin container kind-command target', () => {
	it("routes a registered command's updateMetadata to the container's updateOwnMetadata", () => {
		const updateOwnMetadata = vi.fn();
		const handler = vi.fn((ctx: { updateMetadata(patch: Record<string, unknown>): void }) => {
			ctx.updateMetadata({ calloutType: 'warning' });
			return true;
		});
		const id = registerBlockCommand(note, 'callout.setKind', handler);
		const overrides = bindKindChord(note, 'Mod+Shift+K', id);
		const node = noteNode();

		const handled = dispatchKindCommand(
			'Mod+Shift+K',
			buildContainerKindTarget({ getNode: () => node }, updateOwnMetadata),
			GATES,
			overrides
		);

		expect(handled).toBe(true);
		expect(updateOwnMetadata).toHaveBeenCalledWith({ calloutType: 'warning' });
		// The command context carries the live container node, not a snapshot.
		expect(handler.mock.calls[0][0]).toMatchObject({ node });
	});

	it('threads commandHooks so a handler reaches the mounted component', () => {
		const hooks = { openEdit: vi.fn() };
		const handler = vi.fn((ctx: { hooks?: unknown }) => {
			(ctx.hooks as { openEdit(): void } | undefined)?.openEdit();
			return true;
		});
		const id = registerBlockCommand(note, 'note.edit', handler);
		const overrides = bindKindChord(note, 'Mod+Shift+K', id);
		const node = noteNode();

		const handled = dispatchKindCommand(
			'Mod+Shift+K',
			buildContainerKindTarget({ getNode: () => node, commandHooks: () => hooks }, vi.fn()),
			GATES,
			overrides
		);

		expect(handled).toBe(true);
		expect(handler.mock.calls[0][0]).toMatchObject({ node, hooks });
		expect(hooks.openEdit).toHaveBeenCalledTimes(1);
	});

	it('supplies hooks as undefined when no commandHooks getter is given', () => {
		const handler = vi.fn((_ctx: { hooks?: unknown }) => true);
		const id = registerBlockCommand(note, 'note.noHooks', handler);
		const overrides = bindKindChord(note, 'Mod+Shift+K', id);
		const node = noteNode();

		dispatchKindCommand(
			'Mod+Shift+K',
			buildContainerKindTarget({ getNode: () => node }, vi.fn()),
			GATES,
			overrides
		);

		expect(handler.mock.calls[0][0].hooks).toBeUndefined();
	});

	it('reads getNode() live so a node swap is observed, never snapshotted (thunks, never values)', () => {
		let node = noteNode();
		const target = buildContainerKindTarget({ getNode: () => node }, vi.fn());

		expect(target.kind).toBe(note);

		node = noteNode(noteAlt);
		expect(target.kind).toBe(noteAlt);
		expect(target.getCommandContext?.().node).toBe(node);
	});

	it("exposes the owning plugin's EditorContext as ctx.editor, keyed by pluginKindOwner", () => {
		const fakeEditorContext = { editorId: 'e1' } as unknown as EditorContext;
		recordPluginKindOwner(note, 'admonitions');
		const pluginEditor = vi.fn((name: string) =>
			name === 'admonitions' ? fakeEditorContext : ({} as EditorContext)
		);
		const node = noteNode();

		const target = buildContainerKindTarget({ getNode: () => node }, vi.fn(), pluginEditor);

		expect(target.getCommandContext?.().editor).toBe(fakeEditorContext);
		expect(pluginEditor).toHaveBeenCalledWith('admonitions');
	});
});
