/**
 * Bytes-scoped readonly views over the CST — invariant G1.9 stated in the type
 * system. A node a snapshot still shares is read-only on its serialized bytes,
 * so a view makes every byte-carrying field (`raw`, `kind`, `metadata`,
 * trivia, `children` structure) readonly. `childIds` and `ownerEpoch` are
 * editor bookkeeping, explicitly not round-trip bytes, and their writers are
 * legal on shared nodes — they stay writable through a view.
 *
 * The ONE sanctioned view→mutable door is the unshare seam
 * (`tree-operations/unshare.ts`) plus the commit ceremony's owned scope views:
 * both return nodes proven unshared at runtime, which is exactly when byte
 * writes become legal. Everywhere else, converting a view back to `CstNode`/
 * `Document` is a G1.9 hazard — a source-scan lint holds the perimeter.
 */

import type { CstNode, Document } from './nodes';

// Name-scoped at every recursion depth by design: these names are reserved for
// the two bookkeeping fields — a future nested field so named would be writable
// through a view.
type BytesWritableKey = 'childIds' | 'ownerEpoch';

/**
 * Deep-readonly except the bookkeeping carve-out. Primitives pass through
 * untouched so branded string kinds keep their brands.
 */
export type BytesView<T> = T extends string | number | boolean | bigint | symbol | null | undefined
	? T
	: T extends readonly (infer E)[]
		? readonly BytesView<E>[]
		: { readonly [K in keyof T as K extends BytesWritableKey ? never : K]: BytesView<T[K]> } & {
				[K in keyof T as K extends BytesWritableKey ? K : never]: T[K];
			};

export type NodeView = BytesView<CstNode>;
export type DocumentView = BytesView<Document>;

/** A spine root the unshare seam accepts: the live document or a caller-owned children wrapper. */
export type NodeParentView = { readonly children: readonly NodeView[] };
