// @vitest-environment jsdom
//
// G1.20 — unshared-spine depth. The routine-typing path asks `withUnsharedSpine` for
// an owned chain down to the leaf, then writes through `chain[leafPath.length - 2]`.
// If the chain comes back shorter than the path, that index addresses a node the
// caller does NOT own, and the write lands on a snapshot-shared node — silent history
// corruption that surfaces at a later undo, far from its cause.
//
// The invariant is an inline closure at this seam rather than a registered predicate,
// so nothing could call it directly and no test asserted it fired; its only net was
// the e2e console watcher. `assertInvariant` routes to `devWarn`, which vitest
// suppresses, so the fire is observed by mocking that module — the convention the
// other devWarn suites use.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/dev-warn', () => ({ devWarn: vi.fn() }));

import { devWarn } from '$lib/dev-warn';
import type { CstNode } from '$lib/core/nodes';
import { createNestedBlockEdit } from '$lib/editor-actions/nested/nested-block-edit';
import type { NestedActionsDeps } from '$lib/editor-actions/nested/nested-actions';
import {
	makeBlockListState,
	makeStickyColumn,
	makeStubBlockEdit,
	makeStubContainerEdit,
	makeStubFocus
} from '../../harness/editor-actions';

const CONTAINER_PATH = [2, 1];

function item(): CstNode {
	return {
		kind: 'listItem',
		leadingTrivia: '',
		raw: '',
		children: [{ kind: 'paragraph', leadingTrivia: '', raw: 'text\n' } as CstNode]
	} as CstNode;
}

/**
 * `chainDepth` is what the (stubbed) container edit hands back. The honest depth is
 * the leaf path's own — CONTAINER_PATH plus the inner index — so anything shorter is
 * the violation G1.20 exists to catch.
 */
function typeInto(node: CstNode, chainDepth: number): void {
	const containerEdit = makeStubContainerEdit();
	vi.mocked(containerEdit.withUnsharedSpine).mockImplementation(
		(_path: number[], run: (chain: CstNode[]) => void) => {
			const chain = Array.from({ length: chainDepth }, () => node);
			run(chain);
		}
	);
	const deps = {
		index: 1,
		node,
		path: CONTAINER_PATH,
		stickyColumn: makeStickyColumn(),
		parent: {
			blockEdit: makeStubBlockEdit(),
			focus: makeStubFocus(),
			containerEdit
		}
	} as unknown as NestedActionsDeps;
	void createNestedBlockEdit(
		makeBlockListState(() => node),
		deps
	).updateBlockContent(0, 'typed\n');
}

const violations = () =>
	vi.mocked(devWarn).mock.calls.filter(([tag]) => tag === 'invariant:unshared-spine-depth');

beforeEach(() => vi.mocked(devWarn).mockClear());

describe('G1.20 unshared-spine depth', () => {
	it('stays silent when the chain is as deep as the leaf path', () => {
		typeInto(item(), CONTAINER_PATH.length + 1);

		expect(violations()).toHaveLength(0);
	});

	it('fires when the chain comes back short of the leaf path', () => {
		typeInto(item(), CONTAINER_PATH.length);

		expect(violations()).toHaveLength(1);
		expect(violations()[0][1]).toContain(`chain depth ${CONTAINER_PATH.length} != leaf path depth`);
	});

	// A chain that is too LONG is equally a mismatch: the ownedContainer index would
	// address the wrong ancestor. The predicate is an equality, not a lower bound,
	// and a `<` written where `!==` belongs would let this through.
	it('fires when the chain comes back deeper than the leaf path', () => {
		typeInto(item(), CONTAINER_PATH.length + 2);

		expect(violations()).toHaveLength(1);
	});
});
