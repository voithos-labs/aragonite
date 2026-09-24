// @vitest-environment jsdom
//
// Miss-analysis: transform scoping was pinned only on `applyPasteTransforms` itself, and no test
// pasted through `pasteDispatch` into a plugin kind's block under an activation that left the
// plugin out, so the kind-keyed surface lookup ran an unlisted plugin's hook unseen (GH #394).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetPluginPlatformForTests } from '$lib/testing';
import { definePlugin, installPlugins } from '$lib/schema/plugin-install';
import { declarePluginKind } from '$lib/schema/plugin-kind';
import { activationFor, type PluginActivation } from '$lib/schema/plugin-activation';
import { defaultRegistryView } from '$lib/schema/registry-view';
import { registerPasteTransform } from '$lib/tree-operations/paste/paste-transforms';
import { getPasteSurface, registerPasteSurface } from '$lib/tree-operations/paste-surfaces';
import { defaultInlineHook } from '$lib/tree-operations/paste/hooks';
import { registerChromeLeaf } from '$lib/editor-actions/plugin/chrome-leaf';
import { pasteDispatch } from '$lib/tree-operations/paste/dispatch';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createPasteCoordinator } from '$lib/editor-actions/paste-coordinator';
import { makeEditorActionsDeps, makeStubBlockEdit } from '$lib/test/harness/editor-actions';
import type { CstNode } from '$lib/core/nodes';
import type { BlockComponent } from '$lib/block-component';
import type { Component } from 'svelte';

const KIND = 'stamp-note';
const LEAF = 'stamp-title';
let ran: string[] = [];

const stampPlugin = definePlugin({
	name: 'listed',
	setup() {
		const kind = declarePluginKind(KIND);
		registerPasteTransform({
			name: 'stamp',
			transform: (text) => {
				ran.push('transform');
				return text;
			}
		});
		registerPasteSurface({
			kind,
			onInlinePaste(node, offset, text) {
				ran.push('surface');
				return defaultInlineHook(node, offset, text);
			}
		});
		registerChromeLeaf(declarePluginKind(LEAF), {} as Component<object, BlockComponent>);
	}
});

beforeEach(() => {
	resetPluginPlatformForTests();
	installPlugins([stampPlugin]);
	ran = [];
});
afterEach(resetPluginPlatformForTests);

async function pasteUnder(activePlugins: PluginActivation): Promise<string[]> {
	const node = { kind: KIND, leadingTrivia: '', raw: 'target\n' } as CstNode;
	const { deps } = makeEditorActionsDeps([node]);
	await pasteDispatch(
		{ pastedText: 'word', targetPath: [0], offset: 'target'.length },
		{
			doc: deps.doc,
			blockEdit: makeStubBlockEdit(),
			controller: createPasteCoordinator(createUndoController(deps), deps.revealPath),
			grammar: defaultRegistryView.grammar,
			activePlugins
		}
	);
	return ran;
}

describe("a plugin's paste hooks run only in an editor that lists it", () => {
	// The transform's repeat is the dev idempotence probe re-running it on its own output.
	it('runs the transform and the surface where the plugin is listed', async () => {
		expect(await pasteUnder(activationFor(['listed']))).toEqual([
			'transform',
			'transform',
			'surface'
		]);
	});

	it('runs neither where the plugin is left out, with no missing-surface warning', async () => {
		expect(await pasteUnder(activationFor([]))).toEqual([]);
	});
});

describe('the paste surface lookup reads the activation', () => {
	it('hides a surface registered from setup through registerChromeLeaf', () => {
		expect(getPasteSurface(LEAF as never, activationFor(['listed']))).toBeDefined();
		expect(getPasteSurface(LEAF as never, activationFor([]))).toBeUndefined();
	});
});
