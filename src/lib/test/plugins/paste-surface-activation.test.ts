// @vitest-environment jsdom
// Miss-analysis: no test pasted into a plugin kind's block with that plugin left out (GH #394).
import { beforeEach, describe, expect, it } from 'vitest';
import { definePlugin, installPlugins } from '#lib/schema/plugin-install.js';
import { declarePluginKind } from '#lib/schema/plugin-kind.js';
import { activationFor, type PluginActivation } from '#lib/schema/plugin-activation.js';
import { registerPasteTransform } from '#lib/tree-operations/paste/paste-transforms.js';
import { getPasteSurface, registerPasteSurface } from '#lib/tree-operations/paste-surfaces.js';
import { defaultInlineHook } from '#lib/tree-operations/paste/hooks.js';
import { makePasteCommit, runPasteDispatch } from '#lib/test/harness/editor-actions.js';
import type { CstNode } from '#lib/core/nodes.js';
import { topLevelStore } from '../harness/fixture-grammar';

const KIND = 'stamp-note';
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
				return defaultInlineHook(node, offset, text, undefined, topLevelStore(node), '\n');
			}
		});
	}
});

beforeEach(() => {
	installPlugins([stampPlugin]);
	ran = [];
});

async function pasteUnder(activePlugins: PluginActivation): Promise<string[]> {
	const node = { kind: KIND, leadingTrivia: '', raw: 'target\n' } as CstNode;
	const h = makePasteCommit([node]);
	await runPasteDispatch(
		h,
		{ pastedText: 'word', targetPath: [0], offset: 'target'.length },
		{ activePlugins }
	);
	return ran;
}

describe("a plugin's paste hooks run only in an editor that lists it", () => {
	// The transform's repeat is the dev-mode idempotence check re-running it on its own output.
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
	it('hides a surface registered from setup', () => {
		expect(getPasteSurface(KIND as never, activationFor(['listed']))).toBeDefined();
		expect(getPasteSurface(KIND as never, activationFor([]))).toBeUndefined();
	});
});
