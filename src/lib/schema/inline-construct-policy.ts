/**
 * Per-inline-kind editing policy: how a construct behaves at its edges, whether emptying it
 * unwraps it, how a split treats its markers, and whether preview-inline's reveal addresses
 * them. Lives in `schema/` because it is the only directory `tree-operations`, `selection`,
 * `components` and `core/inline` can all reach. Rows are data; the split rebalancer is a
 * function value patched in from the component layer, so this module keeps no import of it.
 */

import { isBuiltinInlineKind, type AnyInlineKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { LinkReferenceResolver } from '../core/inline/link-reference-resolver';
import { registerOnce } from './register-once';

// ── Policy rows ─────────────────────────────────────────────────────────────

export interface InlineConstructPolicy {
	edgeAffinity: 'symmetric-pair' | 'never-extend';
	autoUnwrapOnEmpty: boolean;
	splitBehavior: 'close-and-reopen' | 'plain';
	revealable: boolean;
}

const policies = new Map<AnyInlineKind, InlineConstructPolicy>();

export function registerInlineConstructPolicy(
	kind: AnyInlineKind,
	policy: InlineConstructPolicy
): void {
	registerOnce(
		policies.has(kind),
		() => policies.set(kind, policy),
		`registerInlineConstructPolicy: "${kind}" is already registered. Policies are register-once.`
	);
}

/** Undefined for a kind with no row: absent means "no live-mode construct behavior at all". */
export function getInlineConstructPolicy(kind: AnyInlineKind): InlineConstructPolicy | undefined {
	return policies.get(kind);
}

/** Whether preview-inline's construct reveal may flip this kind's marker spans. */
export function isRevealableInlineKind(kind: AnyInlineKind): boolean {
	return policies.get(kind)?.revealable === true;
}

export function listInlineConstructPolicies(): readonly (InlineConstructPolicy & {
	kind: AnyInlineKind;
})[] {
	return [...policies].map(([kind, policy]) => ({ kind, ...policy }));
}

// ── Split rebalancer ────────────────────────────────────────────────────────

/**
 * The link-reference resolver a rewrite parses with, structurally rather than by naming
 * `editor-keys`' type — that would cycle the editor's context module onto every layer this table
 * serves, the reason `inline-cache` states for the same shape. Registration is process-global and
 * the resolver is per-instance, so it rides the CALL, never the registration.
 */
export type InlineResolverRef = { current?: LinkReferenceResolver; signature?: string };

/**
 * The one live-mode split rewrite, consulting each construct's own `splitBehavior`, so
 * `splitNode` needs neither `parseInline` nor a per-kind dispatch. Null declines the rewrite.
 */
export type LiveSplitRebalancer = (
	node: NodeView,
	offset: number,
	firstRaw: string,
	secondRaw: string,
	linkRef: InlineResolverRef | undefined
) => { firstRaw: string; secondRaw: string } | null;

let splitRebalancer: LiveSplitRebalancer | undefined;

export function registerLiveSplitRebalancer(rebalancer: LiveSplitRebalancer): void {
	registerOnce(
		splitRebalancer !== undefined,
		() => (splitRebalancer = rebalancer),
		`registerLiveSplitRebalancer: a rebalancer is already registered. The slot holds one ` +
			`function for every construct — extend that one rather than registering a second.`
	);
}

export function getLiveSplitRebalancer(): LiveSplitRebalancer | undefined {
	return splitRebalancer;
}

// ── Join-seam cleaner ───────────────────────────────────────────────────────

/** One side of a join: the block bytes it contributed and the offset they were cut at — a whole
 *  block's content end for a merge, the selection endpoint for a range delete. */
export interface JoinEndpoint {
	node: NodeView;
	offset: number;
}

/** The bytes a join produced, plus where the second side's contribution starts in them. */
export interface JoinSeam {
	mergedRaw: string;
	seam: number;
	start: JoinEndpoint;
	end: JoinEndpoint;
	/** Per-instance, so it rides the call: a reference form parsed without it reads as brackets,
	 *  and the seam would step around a construct the reader saw as a link. */
	linkRef: InlineResolverRef | undefined;
}

/** The bytes a cleanup wrote and where the two sides now meet in them: dropping a run on the
 *  first side's half moves the seam the caret lands on. */
export interface CleanedJoin {
	raw: string;
	seam: number;
}

/**
 * The one live-mode join rewrite, consulting each construct's own policy row, so the merge
 * primitives need neither `parseInline` nor a per-kind dispatch. Null declines the rewrite.
 */
export type LiveJoinSeamCleaner = (join: JoinSeam) => CleanedJoin | null;

let joinSeamCleaner: LiveJoinSeamCleaner | undefined;

export function registerLiveJoinSeamCleaner(cleaner: LiveJoinSeamCleaner): void {
	registerOnce(
		joinSeamCleaner !== undefined,
		() => (joinSeamCleaner = cleaner),
		`registerLiveJoinSeamCleaner: a cleaner is already registered. The slot holds one ` +
			`function for every construct — extend that one rather than registering a second.`
	);
}

export function getLiveJoinSeamCleaner(): LiveJoinSeamCleaner | undefined {
	return joinSeamCleaner;
}

/** Test-only. Drops every plugin-registered row; built-in rows and the rebalancer survive,
 *  being built-in registrations. */
export function __resetInlineConstructPoliciesForTests(): void {
	for (const kind of policies.keys()) {
		if (!isBuiltinInlineKind(kind)) policies.delete(kind);
	}
}

/** Test-only, and separate on purpose: only a suite testing the SLOT wants it emptied, and the
 *  registry's own reset must not do it as a side effect. */
export function __resetLiveSplitRebalancerForTests(): void {
	splitRebalancer = undefined;
}

/** Test-only, {@link __resetLiveSplitRebalancerForTests}'s twin for the join slot. */
export function __resetLiveJoinSeamCleanerForTests(): void {
	joinSeamCleaner = undefined;
}
