// @vitest-environment jsdom
//
// G1.20 — unshared-spine depth. A chain shorter than the leaf path makes
// `chain[leafPath.length - 2]` address a node the caller does NOT own, so the write lands
// on a snapshot-shared node and corrupts history at a later undo. The invariant is an
// inline closure, so its fire is observed by mocking `$lib/dev-warn`.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/dev-warn', () => ({ devWarn: vi.fn() }));

import { devWarn } from '$lib/dev-warn';
import type { CstNode } from '$lib/core/nodes';
import type { SharingState } from '$lib/tree-operations/sharing';
import { createSharingState } from '$lib/tree-operations/sharing';
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

/** `chainDepth` is what the stubbed container edit hands back; the honest depth is
 *  CONTAINER_PATH plus the inner index. */
function typeInto(node: CstNode, chainDepth: number): void {
	const containerEdit = makeStubContainerEdit();
	vi.mocked(containerEdit.withUnsharedSpine).mockImplementation(
		(_path: number[], run: (chain: CstNode[], sharing: SharingState) => void) => {
			const chain = Array.from({ length: chainDepth }, () => node);
			run(chain, createSharingState());
			return false;
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

	// The predicate is an equality, not a lower bound: a `<` written where `!==` belongs
	// would let an over-long chain address the wrong ancestor.
	it('fires when the chain comes back deeper than the leaf path', () => {
		typeInto(item(), CONTAINER_PATH.length + 2);

		expect(violations()).toHaveLength(1);
	});
});
