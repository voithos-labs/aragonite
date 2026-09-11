/**
 * Decides a deliberate divergence on the DIVERGENCE, not on the input: each class neutralizes
 * its construct on both sides and demands the rest still match, so a real bug standing next to
 * an excused construct is no longer excused along with it.
 */
import type { Divergence } from './differ';
import { mergeAdjacentText, normalEqual, type NormalNode } from './normalize';

export type DivergenceClass =
	'gfm-bare-autolink' | 'image-alt-structure' | 'emphasis-flanking-astral';

/** Named in the unexplained-divergence red so it says what was already ruled out. */
export const NEUTRALIZATIONS_TRIED =
	'bare autolinks folded to text then sized to their delimiter reach, image alts erased, ' +
	'astral-beside-delimiter';

// ── Public API ───────────────────────────────────────────────────────────────

/** The class whose neutralization explained this divergence, or null if none does. */
export function explainDivergence(divergence: Divergence): DivergenceClass | null {
	const ours = foldBareAutolinks(divergence.ours);
	const theirs = mergeAdjacentText(divergence.theirs);
	if (normalEqual(ours, theirs)) return 'gfm-bare-autolink';
	const altFreeOurs = eraseImageAlt(ours);
	const altFreeTheirs = eraseImageAlt(theirs);
	if (normalEqual(altFreeOurs, altFreeTheirs)) return 'image-alt-structure';
	if (isAutolinkReach(divergence, altFreeOurs, altFreeTheirs)) return 'gfm-bare-autolink';
	if (hasAstralBesideDelimiter(divergence.input)) return 'emphasis-flanking-astral';
	return null;
}

// ── Neutralizers ─────────────────────────────────────────────────────────────

/** Reads a bare autolink the way the extension-less reference does: as its own bytes. */
export function foldBareAutolinks(nodes: NormalNode[]): NormalNode[] {
	return mergeAdjacentText(nodes.map(foldNode));
}

/**
 * Erases, rather than reconciles, the alt subtree: ours holds the label's raw source bytes and
 * the reference holds them parsed, and no flattening of either side converges on the other.
 */
export function eraseImageAlt(nodes: NormalNode[]): NormalNode[] {
	return nodes.map((node) => {
		if (node.kind === 'image') return { ...node, children: [] };
		return node.children ? { ...node, children: eraseImageAlt(node.children) } : node;
	});
}

/**
 * A mechanism, not a construct: commonmark.js classifies flanking by UTF-16 unit, so only an
 * astral code point touching a `*`/`_` run can push the two parsers onto different pairings.
 */
export function hasAstralBesideDelimiter(input: string): boolean {
	return /[\u{10000}-\u{10FFFF}][*_]|[*_][\u{10000}-\u{10FFFF}]/u.test(input);
}

// ── The extension's reach ────────────────────────────────────────────────────

/**
 * Folding cannot give back what the extension took: a bare autolink's bytes are no delimiter
 * run's content and its URL scanner swallows `*`/`_`, so the reference pairs delimiters we never
 * offered. Excused only over a reaching autolink's own bytes, and only if they still conserve.
 */
function isAutolinkReach(
	divergence: Divergence,
	ours: NormalNode[],
	theirs: NormalNode[]
): boolean {
	const reaching = reachingAutolinks(divergence);
	if (reaching.length === 0) return false;
	const [ourWindow, theirWindow] = narrowToDisagreement(ours, theirs);
	const covered = plainText(ourWindow);
	return (
		reaching.some((bytes) => covered.includes(bytes)) &&
		withoutDelimiters(covered) === withoutDelimiters(plainText(theirWindow))
	);
}

/** The source bytes of every bare autolink whose span holds or abuts a `*`/`_`. */
function reachingAutolinks({ input, ours }: Divergence): string[] {
	return bareAutolinks(ours)
		.filter(
			({ span, bytes }) =>
				/[*_]/.test(bytes) || isDelimiter(input[span.start - 1]) || isDelimiter(input[span.end])
		)
		.map(({ bytes }) => bytes);
}

/** The narrowest sub-sequences that still hold every difference. */
function narrowToDisagreement(
	ours: NormalNode[],
	theirs: NormalNode[]
): [NormalNode[], NormalNode[]] {
	let lead = 0;
	while (lead < ours.length && lead < theirs.length && nodeEqual(ours[lead], theirs[lead])) lead++;
	let trail = 0;
	while (
		trail < Math.min(ours.length, theirs.length) - lead &&
		nodeEqual(ours[ours.length - 1 - trail], theirs[theirs.length - 1 - trail])
	) {
		trail++;
	}
	const [ourWindow, theirWindow] = [
		ours.slice(lead, ours.length - trail),
		theirs.slice(lead, theirs.length - trail)
	];
	if (
		ourWindow.length === 1 &&
		theirWindow.length === 1 &&
		sameShell(ourWindow[0], theirWindow[0])
	) {
		return narrowToDisagreement(ourWindow[0].children ?? [], theirWindow[0].children ?? []);
	}
	return [ourWindow, theirWindow];
}

// ── Internal ─────────────────────────────────────────────────────────────────

function foldNode(node: NormalNode): NormalNode {
	if (node.autolinkSpan) return { kind: 'text', text: plainText(node.children ?? []) };
	return node.children ? { ...node, children: node.children.map(foldNode) } : node;
}

function bareAutolinks(
	nodes: NormalNode[]
): Array<{ span: { start: number; end: number }; bytes: string }> {
	return nodes.flatMap((node) =>
		node.autolinkSpan
			? [{ span: node.autolinkSpan, bytes: plainText(node.children ?? []) }]
			: bareAutolinks(node.children ?? [])
	);
}

function isDelimiter(char: string | undefined): boolean {
	return char === '*' || char === '_';
}

function nodeEqual(a: NormalNode, b: NormalNode): boolean {
	return normalEqual([a], [b]);
}

/** Equal but for children, so a shared wrapper can be stepped through. */
function sameShell(a: NormalNode, b: NormalNode): boolean {
	return a.kind === b.kind && a.text === b.text && a.url === b.url && a.title === b.title;
}

function plainText(nodes: NormalNode[]): string {
	return nodes.map((node) => node.text ?? plainText(node.children ?? [])).join('');
}

function withoutDelimiters(text: string): string {
	return text.replace(/[*_]/g, '');
}
