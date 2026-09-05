import { describe, expect, it, vi } from 'vitest';
import { gateDescendOnCollapse } from '$lib/editor-actions/plugin/container';
import { createBlockEditCore } from '$lib/editor-actions/block-edit-core';
import type { CstNode } from '$lib/core/nodes';
import type { BlockComponent } from '$lib/block-component';
import { makeCommitScopeStub, parseLeaf as leaf } from '$lib/test/harness/editor-actions';

const stubScope = (children: CstNode[], refs: (BlockComponent | undefined)[] = []) =>
	makeCommitScopeStub(children, { refs });

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
