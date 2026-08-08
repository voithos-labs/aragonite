/**
 * Per-inline-kind editing policy: how a construct behaves at its edges, whether emptying it
 * unwraps it, how a split treats its markers, and whether preview-inline's reveal addresses
 * them. Lives in `schema/` because it is the only directory `tree-operations`, `selection`,
 * `components` and `core/inline` can all reach. Rows are data; the split rebalancer is a
 * function value patched in from the component layer, so this module keeps no import of it.
 */

import { isBuiltinInlineKind, type AnyInlineKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
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
		`registerInlineConstructPolicy: "${kind}" is already registered. Policies are ` +
			`register-once — use augmentInlineConstructPolicy to merge fields into an existing row.`
	);
}

/** Undefined for a kind with no row: absent means "no live-mode construct behavior at all". */
export function getInlineConstructPolicy(kind: AnyInlineKind): InlineConstructPolicy | undefined {
	return policies.get(kind);
}

/**
 * Layer fields onto an already-registered row. The editor-layer wire-up patches behavior it
 * would otherwise take a component import to declare. Throws for an unregistered kind.
 */
export function augmentInlineConstructPolicy(
	kind: AnyInlineKind,
	patch: Partial<InlineConstructPolicy>
): void {
	const policy = policies.get(kind);
	if (!policy) {
		throw new Error(
			`augmentInlineConstructPolicy: "${kind}" is not registered — register the policy row ` +
				`before augmenting it.`
		);
	}
	policies.set(kind, { ...policy, ...patch });
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
 * The one live-mode split rewrite, consulting each construct's own `splitBehavior`, so
 * `splitNode` needs neither `parseInline` nor a per-kind dispatch. Null declines the rewrite.
 */
export type LiveSplitRebalancer = (
	node: NodeView,
	offset: number,
	firstRaw: string,
	secondRaw: string
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

/** Test-only. Drops every plugin-registered row; built-in rows survive, and so does the
 *  rebalancer — it is a built-in registration, and dropping it silently retired live splits
 *  for every suite that reset between cases. */
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
