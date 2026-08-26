/**
 * G1.9 in the type system (G3.8): a snapshot-shared node is read-only on its serialized bytes,
 * so a view freezes every byte-carrying field. `childIds`, `childSpans` and `ownerEpoch` are
 * editor bookkeeping, not round-trip bytes, and stay writable through a view. The ONE sanctioned
 * view-to-mutable door is the unshare seam (`tree-operations/unshare.ts`) plus the commit
 * ceremony's owned scope views (G4.13); everywhere else the source-scan lint holds the perimeter.
 */

import type { CstNode, Document } from './nodes';

// Name-scoped at every recursion depth by design, so these three names are reserved: a future
// nested field so named would be writable through a view.
type BytesWritableKey = 'childIds' | 'childSpans' | 'ownerEpoch';

/** Primitives pass through untouched, so branded string kinds keep their brands. */
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
