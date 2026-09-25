/**
 * Per-inline-kind editing policy: how a construct behaves at its edges, whether emptying it
 * unwraps it, how a split treats its markers, whether preview-inline may show its markers, and
 * what a format chord writes for it. The rows are data; the live split and join rewrites are
 * functions the component layer registers here.
 */

import { isBuiltinInlineKind, type AnyInlineKind } from '../core/nodes';
import type { NodeView } from '../core/node-views';
import type { Reading } from './reading';
import type { AnyCommandId } from './command-id';
import { isBuiltinCommandId } from './commands';
import { registerOnce } from './register-once';
import { everyInstalledPlugin } from './plugin-activation';
import { createPluginRegistry } from './plugin-registry';

// ── Policy rows ─────────────────────────────────────────────────────────────

/** The constructs a format chord addresses: whichever rows below declare a mark. An alias rather
 *  than a union, so a plugin's markable kind needs no edit here; membership is the row lookup,
 *  done at runtime. */
export type InlineMarkKind = AnyInlineKind;

/**
 * What a format chord needs in order to write a construct's own delimiters. Present in full or
 * absent, so a kind cannot call itself markable without saying what a mark on it writes.
 */
export interface InlineMarkPolicy {
	/** Where the kind sits when one insertion carries several marks: ascending is outermost first,
	 *  and the order is this table's, never the order the chords arrived in. */
	nestingRank: number;
	/** The bare run that opens and closes the construct. */
	markerBytes: string;
	/** Wrap `content` for a kind whose delimiters depend on what they enclose: a code span makes
	 *  its fence longer than the longest run inside it. Absent means marker, content, marker. */
	wrapBytes?: (content: string) => string;
	/** The command that toggles this mark. */
	command: AnyCommandId;
}

export interface InlineConstructPolicy {
	edgeAffinity: 'symmetric-pair' | 'never-extend';
	autoUnwrapOnEmpty: boolean;
	splitBehavior: 'close-and-reopen' | 'plain';
	revealable: boolean;
	/** Whether the link card is how this construct's destination is edited, the only way left in a
	 *  mode that shows the user no URL (live-mode.md § 4.6). Absent reads as no: an image's
	 *  destination has its own editor, and an autolink's destination is the text on screen. */
	cardEditable?: boolean;
	/** Absent for a construct no format chord addresses. */
	mark?: InlineMarkPolicy;
}

// Read with no editor at hand: a row matters only for a node of its kind, and only an editor
// that activated the kind's plugin parses one, so the rows answer for every installed plugin.
const policies = createPluginRegistry<AnyInlineKind, InlineConstructPolicy>({
	label: 'registerInlineConstructPolicy',
	isBuiltin: isBuiltinInlineKind
});
const policyOf = (kind: AnyInlineKind) => policies.get(kind, everyInstalledPlugin);

export function registerInlineConstructPolicy(
	kind: AnyInlineKind,
	policy: InlineConstructPolicy
): void {
	assertMarkCommandMintable(kind, policy.mark);
	assertCardImpliesRevealable(kind, policy);
	policies.register(
		kind,
		policy,
		`registerInlineConstructPolicy: "${kind}" is already registered. Policies are register-once.`
	);
}

/** Runs before the register-once check, so it throws in every environment: that check forgives a
 *  duplicate row, never an invalid one. G1.31 states the rule and still backs it up. */
function assertMarkCommandMintable(kind: AnyInlineKind, mark: InlineMarkPolicy | undefined): void {
	if (!mark || isBuiltinInlineKind(kind) || !isBuiltinCommandId(mark.command)) return;
	throw new Error(
		`registerInlineConstructPolicy: "${kind}" claims built-in command "${mark.command}" for its mark; that id already has a built-in meaning; create a plugin command id for the mark`
	);
}

/** The code that opens the card reaches only revealable kinds (`link-at-point.ts`), so a row that
 *  asks for the card without `revealable` asks for something that can never open. Thrown here
 *  rather than left as a silent no-op at the click. */
function assertCardImpliesRevealable(kind: AnyInlineKind, policy: InlineConstructPolicy): void {
	if (!policy.cardEditable || policy.revealable) return;
	throw new Error(
		`registerInlineConstructPolicy: "${kind}" declares cardEditable without revealable; the card's open chain reaches only revealable kinds, so the entry point would never open`
	);
}

/** Undefined for a kind with no row: absent means "no live-mode construct behavior at all". */
export function getInlineConstructPolicy(kind: AnyInlineKind): InlineConstructPolicy | undefined {
	return policyOf(kind);
}

/** Whether the preview-inline mode may show this kind's markers. */
export function isRevealableInlineKind(kind: AnyInlineKind): boolean {
	return policyOf(kind)?.revealable === true;
}

/** Whether the link card may address this kind's destination. */
export function isCardEditableInlineKind(kind: AnyInlineKind): boolean {
	return policyOf(kind)?.cardEditable === true;
}

export function listInlineConstructPolicies(): readonly (InlineConstructPolicy & {
	kind: AnyInlineKind;
})[] {
	return policies.entries(everyInstalledPlugin).map(([kind, policy]) => ({ kind, ...policy }));
}

// ── The mark vocabulary ─────────────────────────────────────────────────────

/** A kind's mark policy, or undefined for a kind no chord addresses. The toggle paths check this
 *  before writing any delimiter. */
export function getInlineMarkPolicy(kind: AnyInlineKind): InlineMarkPolicy | undefined {
	return policyOf(kind)?.mark;
}

export interface InlineMark {
	kind: AnyInlineKind;
	mark: InlineMarkPolicy;
}

/** Every markable kind, outermost first. Returning the row with the kind saves each caller a
 *  second lookup that could miss. */
export function listInlineMarks(): readonly InlineMark[] {
	const marks: InlineMark[] = [];
	for (const [kind, policy] of policies.entries(everyInstalledPlugin)) {
		if (policy.mark) marks.push({ kind, mark: policy.mark });
	}
	return marks.sort((a, b) => a.mark.nestingRank - b.mark.nestingRank);
}

/** The mark a command toggles, or null when no row claims that command. */
export function inlineMarkForCommand(command: string): InlineMark | null {
	return listInlineMarks().find((entry) => entry.mark.command === command) ?? null;
}

// ── Split rebalancer ────────────────────────────────────────────────────────

/**
 * The one live-mode split rewrite, consulting each construct's own `splitBehavior`, so
 * `splitNode` needs neither `parseInline` nor a per-kind dispatch. Null declines the rewrite.
 * Registration is process-wide, so the editor's reading is passed on each call.
 */
export type LiveSplitRebalancer = (
	node: NodeView,
	offset: number,
	firstRaw: string,
	secondRaw: string,
	reading: Reading
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

// ── Join cleanup ───────────────────────────────────────────────────────────

/** One side of a join: the block it contributed bytes from and the offset they were cut at. A
 *  merge cuts at the end of the block's content, a range delete at the selection endpoint. */
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
	/** Belongs to one editor, so it is passed on the call: a reference link parsed without it reads
	 *  as plain brackets, and the cleanup would skip a construct the user saw as a link. */
	reading: Reading;
	/** Text the caller will insert at the join once the cleanup returns. Absent for a plain delete;
	 *  when present it is part of the bytes the cleanup has to check, since typed text changes what
	 *  a surviving delimiter pairs against. */
	typed?: string;
	/** The container's marker prefix the surviving side sits under (`- `, `> `). Absent where the
	 *  block has none. The result is parsed back through it: an item's body starting with a space
	 *  would otherwise reparse under a wider marker than the tree holds. */
	ambientPrefix?: string;
}

/** The bytes a cleanup wrote and where the two sides now meet in them: dropping characters from
 *  the first side moves the point the caret lands on. */
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

/** Test-only, and separate on purpose: only a suite testing this one function wants it cleared,
 *  and the registry's own reset must not clear it as a side effect. */
export function __resetLiveSplitRebalancerForTests(): void {
	splitRebalancer = undefined;
}

/** Test-only, the join cleaner's counterpart to {@link __resetLiveSplitRebalancerForTests}. */
export function __resetLiveJoinSeamCleanerForTests(): void {
	joinSeamCleaner = undefined;
}
