/**
 * A node shared with an undo snapshot is read-only on its serialized bytes (G1.9), and a view
 * types that: every byte-carrying field is frozen. `childIds`, `childSpans` and `ownerEpoch` are
 * editor bookkeeping, not round-trip bytes, and stay writable. The only casts from a view back to
 * a mutable node are the copy-before-write in `tree-operations/unshare.ts` and the commit
 * sequence's owned views (G4.13); a lint test holds that line everywhere else.
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

/** A root the copy-before-write in `tree-operations/unshare.ts` accepts: the live document or a
 *  caller-owned children wrapper. */
export type NodeParentView = { readonly children: readonly NodeView[] };
