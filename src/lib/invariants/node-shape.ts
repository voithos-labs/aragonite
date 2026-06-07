import type { CstNode } from '../core/nodes';
import { getBlockKindDescriptor, type MergeRole } from '../schema/block-kind-descriptor';
import { cloneNode } from '../tree-operations/clone';
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
 * G1.1 — a strip container's `raw` is in sync with its `children`. Clones the
 * node (never mutates the input), runs the kind's `rebuildRaw` on the clone,
 * and compares. Strip containers only; grid containers (table/tableRow) and
 * leaves are exempt — their raw↔children relationship doesn't satisfy
 * `strip(raw) === serialize(children)`.
 */
export function checkStaleRaw(node: CstNode): InvariantViolation | null {
	const d = getBlockKindDescriptor(node.kind);
	if (d.containerContract !== 'strip' || !d.rebuildRaw) return null;

	const clone = cloneNode(node);
	d.rebuildRaw(clone);
	if (clone.raw !== node.raw) {
		return {
			code: 'stale-container-raw',
			message: `${node.kind} raw is stale relative to its children`,
			detail: { kind: node.kind, rawLen: node.raw.length, rebuiltLen: clone.raw.length }
		};
	}
	return null;
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
