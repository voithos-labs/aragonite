import { describe, expect, it, vi } from 'vitest';
import { gateDescendOnCollapse } from '$lib/editor-actions/plugin/container';
import { createBlockEditCore } from '$lib/editor-actions/block-edit-core';
import type { CommitScope, ScopeCommitArgs } from '$lib/editor-actions/block-edit-scope';
import { createSharingState } from '$lib/tree-operations/sharing';
import type { CstNode } from '$lib/core/nodes';
import type { BlockComponent } from '$lib/block-component';
import { parse } from '$lib/core/parser';

function leaf(raw: string): CstNode {
	return parse(raw).children[0];
}

// Runs the REAL mutate against a live children array, recording commits.
function stubScope(children: CstNode[], refs: (BlockComponent | undefined)[] = []) {
	const commits: ScopeCommitArgs[] = [];
	const sharing = createSharingState();
	const scope: CommitScope = {
		children: () => children,
		refAt: (i) => refs[i],
		collapseEmptyReplaceToDelete: true,
		async commit(args) {
			commits.push(args);
			args.mutate({
				children,
				sharing,
				owner: undefined,
				getPresentationMode: undefined,
				linkRef: undefined,
				unshareChild: (i) => children[i]
			});
			await args.afterTick?.();
		}
	};
	return { scope, commits, children };
}

describe('gateDescendOnCollapse (M3)', () => {
	it('collapsed: consumes the key without minting a body or committing', async () => {
		const { scope, commits, children } = stubScope([leaf('Title\n')]);
		const core = createBlockEditCore(scope);
		const gated = gateDescendOnCollapse(() => true, core.descendToBody);

		await gated(0);

		expect(children).toHaveLength(1);
		expect(commits).toHaveLength(0);
	});

	it('expanded: delegates to descend, minting and committing when the chrome is childless', async () => {
		const { scope, commits, children } = stubScope([leaf('Title\n')]);
		const core = createBlockEditCore(scope);
		const gated = gateDescendOnCollapse(() => false, core.descendToBody);

		await gated(0);

		expect(children).toHaveLength(2);
		expect(children[1].kind).toBe('paragraph');
		expect(commits[0].op.kind).toBe('appendBlock');
	});

	it('no isCollapsed getter: transparent passthrough to descend (callout parity)', async () => {
		const descend = vi.fn();
		const gated = gateDescendOnCollapse(undefined, descend);

		await gated(2);

		expect(descend).toHaveBeenCalledExactlyOnceWith(2);
	});
});
