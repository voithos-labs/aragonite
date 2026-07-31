// @vitest-environment jsdom
//
// Indenting a list item splices the item's NODE into a new parent, so the same
// node is claimed by a dying mount and a fresh one. The registry's contested-claim
// report has to read that as a handoff, not as corruption — it used to warn on
// every Tab. The regression this guards
// in the other direction is the handoff landing backwards: the registry entry must
// be the LIVE mount's state, or every later commit at that scope addresses refs
// nothing renders.
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { installLayoutStubs, mountEditor, pressKeyAt } from '../blocks/editor-mount';
import { getStateForNode } from '$lib/reactivity/state-registry';
import type { CstNode, Document } from '$lib/core/nodes';
import type { EditorInstance } from '$lib/editor-props';

type DocumentReader = EditorInstance & { __test: { getDocument(): Document } };

beforeAll(installLayoutStubs);

let mounted: ReturnType<typeof mountEditor>;
afterEach(async () => {
	if (mounted) await mounted.destroy();
});

function nodeAtPath(editor: ReturnType<typeof mountEditor>, path: number[]): CstNode {
	let node = (editor.instance as DocumentReader).__test.getDocument() as unknown as CstNode;
	for (const i of path) node = node.children![i];
	return node;
}

describe('list indent hands the item node to its new mount', () => {
	it('lands the registry on the live mount without reporting a contested claim', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mounted = mountEditor({ source: '- alpha\n- beta\n' });

		const stateBeforeIndent = getStateForNode(nodeAtPath(mounted, [0, 1]));
		expect(stateBeforeIndent?.innerBlockRefs[0], 'the pre-indent mount is live').toBeDefined();

		await pressKeyAt(mounted, [0, 1, 0], 0, { key: 'Tab' });
		await mounted.settle();
		expect(mounted.source()).toBe('- alpha\n  - beta\n');

		// The moved item, now the nested list's only child.
		const stateAfterIndent = getStateForNode(nodeAtPath(mounted, [0, 0, 1, 0]));
		expect(stateAfterIndent, 'the moved node resolves a state').toBeDefined();
		expect(stateAfterIndent, 'the fresh mount won the claim').not.toBe(stateBeforeIndent);
		expect(stateAfterIndent!.innerBlockRefs[0], 'the winner renders the item').toBeDefined();
		expect(stateBeforeIndent!.innerBlockRefs[0], 'the loser was torn down').toBeUndefined();

		const registryWarnings = warn.mock.calls
			.map((call) => String(call[0]))
			.filter((message) => message.startsWith('[state-registry]'));
		warn.mockRestore();
		expect(registryWarnings).toEqual([]);
	});
});
