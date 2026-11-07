/**
 * Per-inline-kind editing policy: how a construct behaves at its edges, whether emptying it
 * unwraps it, how a split treats its markers, whether preview-inline may show its markers, and
 * what a format chord writes for it. The rows are data; the live split and join rewrites are
 * functions the component layer registers here.
 */

import { isBuiltinInlineKind, type AnyInlineKind } from '../core/nodes';
import type { AnyCommandId } from './command-id';
import { isBuiltinCommandId } from './commands';
import { everyInstalledPlugin } from './plugin-activation';
import { createInlineKindRegistry } from './plugin-kind';

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

/** How a hidden edge decides where a letter typed at it goes: with the character before the caret,
 *  at one of two drawn stops either side of a painted box, or never inside the construct. */
export type EdgePolicy = 'left-sticky' | 'boxed' | 'never-extend';

export interface InlineConstructPolicy {
	edgeAffinity: EdgePolicy;
	autoUnwrapOnEmpty: boolean;
	splitBehavior: SplitBehavior;
	revealable: boolean;
	/** Present when a click follows the construct, saying how Edit link and Mod+K edit it then.
	 *  Absent reads as a construct a click never follows. */
	followEdit?: FollowEdit;
	/** Absent for a construct no format chord addresses. */
	mark?: InlineMarkPolicy;
	/**
	 * How much of the construct is prose, where a trigger such as `#` may open the inline menu.
	 * Absent reads as `'all'`, or `'none'` for an inline widget kind.
	 */
	prose?: InlineProseExtent;
}

export type InlineProseExtent = 'none' | 'content' | 'all';

/** How a cut inside the construct treats it. `close-and-reopen` closes it before the cut and reopens
 *  it after (Enter, a pending mark, a live delete), `plain` leaves the literal cut, and `whole` means
 *  no part stands alone: Enter moves the cut to its nearer edge, and a delete whose every cut
 *  unmakes it takes it whole (live-mode.md § 4.4). */
export type SplitBehavior = 'close-and-reopen' | 'whole' | 'plain';

/** `card`: the link card edits the text and the destination, the only way in a mode that hides
 *  the URL (`docs/design/live-mode.md` § 4.6 The link card). */
export type FollowEdit = 'card';

// Read with no editor at hand: a row matters only for a node of its kind, and only an editor
// that activated the kind's plugin parses one, so the rows answer for every installed plugin.
const policies = createInlineKindRegistry<InlineConstructPolicy>({
	label: 'registerInlineConstructPolicy',
	isBuiltin: isBuiltinInlineKind
});
const policyOf = (kind: AnyInlineKind) => policies.get(kind, everyInstalledPlugin);

export function registerInlineConstructPolicy(
	kind: AnyInlineKind,
	policy: InlineConstructPolicy
): void {
	assertMarkCommandMintable(kind, policy.mark);
	policies.register(
		kind,
		policy,
		`registerInlineConstructPolicy: "${kind}" is already registered. Policies are register-once.`
	);
}

/** Runs before the register-once check, so it throws in every environment: that check forgives a
 *  duplicate row, never an invalid one. */
function assertMarkCommandMintable(kind: AnyInlineKind, mark: InlineMarkPolicy | undefined): void {
	if (!mark || isBuiltinInlineKind(kind) || !isBuiltinCommandId(mark.command)) return;
	throw new Error(
		`registerInlineConstructPolicy: "${kind}" claims built-in command "${mark.command}" for its mark; that id already has a built-in meaning; create a plugin command id for the mark`
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

/** How Edit link edits a construct of this kind a click follows, or undefined for one it doesn't. */
export function followEditOf(kind: AnyInlineKind): FollowEdit | undefined {
	return policyOf(kind)?.followEdit;
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

/** The mark a command toggles, or null when no row names that command. */
export function inlineMarkForCommand(command: string): InlineMark | null {
	return listInlineMarks().find((entry) => entry.mark.command === command) ?? null;
}
