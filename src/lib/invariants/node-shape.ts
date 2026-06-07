import type { CstNode } from '../core/nodes';
import { parse } from '../core/parser';
import { getBlockKindDescriptor, type MergeRole } from '../schema/block-kind-descriptor';
import type { InvariantViolation } from './assert';

// ── G1.5: category ↔ field legality ──────────────────────────────────────────

const MERGE_ROLES: ReadonlySet<MergeRole> = new Set([
	'prose',
	'prose-absorber',
	'container',
	'self-merge',
	'not-mergeable'
]);

/**
 * G1.5 — a node's fields match its kind's category. Implications are
 * one-directional (a container *may* be transiently childless mid-edit, so we
 * never require fields, only forbid illegal ones):
 *   - non-containers must not carry `children`;
 *   - non-prose kinds must not carry `inlineContent`;
 *   - container structural fields (`innerPrefix`/`innerSuffix`) only on containers;
 *   - `mergeRole` must be one of the five legal roles.
 */
export function checkCategoryFields(node: CstNode): InvariantViolation | null {
	const d = getBlockKindDescriptor(node.kind);

	if (!d.isContainer && node.children !== undefined) {
		return illegalField(node.kind, 'children', 'leaf carries children');
	}
	if (!d.supportsInline && node.inlineContent !== undefined) {
		return illegalField(node.kind, 'inlineContent', 'non-prose carries inlineContent');
	}
	if (!d.isContainer && node.innerPrefix !== undefined) {
		return illegalField(node.kind, 'innerPrefix', 'leaf carries container structural field');
	}
	if (!d.isContainer && node.innerSuffix !== undefined) {
		return illegalField(node.kind, 'innerSuffix', 'leaf carries container structural field');
	}
	if (!MERGE_ROLES.has(d.mergeRole)) {
		return illegalField(node.kind, 'mergeRole', `unknown mergeRole "${d.mergeRole}"`);
	}
	return null;
}

function illegalField(kind: string, field: string, why: string): InvariantViolation {
	return {
		code: 'illegal-fields-for-kind',
		message: `${kind}: ${why}`,
		detail: { kind, field }
	};
}

// ── G1.1: container raw not stale ─────────────────────────────────────────────

/**
 * G1.1 — a strip container's `raw` agrees with its `children`: `strip(raw) ===
 * serialize(children)`. Checked semantically by re-parsing `node.raw` and
 * structurally comparing the result's children to `node.children` — a faithful
 * node re-parses to the same children; a drifted one does not. This is
 * canonicalization-proof, unlike comparing against a `rebuildRaw` that
 * re-derives the `> ` prefix / strips indentation the parser preserved.
 *
 * Strip containers only; grid containers (table/tableRow) and leaves are exempt.
 */
export function checkStaleRaw(node: CstNode): InvariantViolation | null {
	if (getBlockKindDescriptor(node.kind).containerContract !== 'strip') return null;

	// `listItem` is never a top-level block, so its raw re-parses to a wrapping
	// `list`; unwrap one level by kind to reach the grammatical correspondent.
	const top = parse(node.raw).children[0];
	const correspondent =
		top?.kind === node.kind ? top : top?.children?.find((c) => c.kind === node.kind);

	if (!structurallyEqualChildren(correspondent?.children, node.children)) {
		return {
			code: 'stale-container-raw',
			message: `${node.kind} raw is stale relative to its children`,
			detail: { kind: node.kind }
		};
	}
	return null;
}

/** Recursively equal on `kind`, `leadingTrivia`, and `raw` (raw is the source of truth). */
function structurallyEqualChildren(
	a: readonly CstNode[] | undefined,
	b: readonly CstNode[] | undefined
): boolean {
	const left = a ?? [];
	const right = b ?? [];
	if (left.length !== right.length) return false;
	for (let i = 0; i < left.length; i++) {
		if (left[i].kind !== right[i].kind) return false;
		if (left[i].leadingTrivia !== right[i].leadingTrivia) return false;
		if (left[i].raw !== right[i].raw) return false;
		if (!structurallyEqualChildren(left[i].children, right[i].children)) return false;
	}
	return true;
}

// ── G1.6: clone-safe metadata ─────────────────────────────────────────────────

/**
 * G1.6 — metadata survives the one-level undo clone (`cloneMetadata` copies
 * `Array.isArray(v) ? [...v] : v`). Every value must be a primitive or an array
 * of primitives; a nested object or array-of-objects would be shared by
 * reference with the snapshot and corrupt undo.
 */
export function checkCloneSafeMetadata(node: CstNode): InvariantViolation | null {
	if (!node.metadata) return null;

	for (const [field, value] of Object.entries(node.metadata)) {
		if (Array.isArray(value)) {
			if (!value.every(isPrimitive)) {
				return notCloneSafe(node.kind, field, 'array contains a non-primitive');
			}
		} else if (!isPrimitive(value)) {
			return notCloneSafe(node.kind, field, 'value is a nested object');
		}
	}
	return null;
}

function notCloneSafe(kind: string, field: string, why: string): InvariantViolation {
	return {
		code: 'metadata-not-clone-safe',
		message: `${kind}.${field}: ${why}`,
		detail: { kind, field }
	};
}

function isPrimitive(value: unknown): boolean {
	if (value === null) return true;
	const t = typeof value;
	return t !== 'object' && t !== 'function';
}
