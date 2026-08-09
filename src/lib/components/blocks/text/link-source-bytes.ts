/**
 * Where a link edit becomes bytes: the seam every link write path calls (G4.34), and under it the
 * GFM branch. A candidate is written only once the RENDER PATH says the reader sees exactly what
 * they saw before — a destination that breaks its own construct surfaces as literal source, which
 * a private walk over the parse cannot see.
 */

import { parseInline } from '../../../core/inline';
import { encodeDestination, escapeTitle } from '../../../core/inline/destination-bytes';
import type { LinkReferenceResolver } from '../../../core/inline/link-reference-resolver';
import { renderedText } from '../../../core/inline-render';
import type { InlineNode } from '../../../core/nodes';
import { devWarn } from '../../../dev-warn';

// ── The write seam ──────────────────────────────────────────────────────────

export interface LinkFields {
	/** RAW inner bytes of the link text. Never re-escaped: the text holds whole nested constructs,
	 *  and re-emitting them from the parse would rewrite bytes the user never touched. */
	text: string;
	url: string;
	title?: string;
	/** Reference forms only: the raw tail after the text's `]` (`[ref]`, `[]`, or empty for the
	 *  shortcut form). Present preserves the reference; absent inlines the destination. */
	reference?: string;
}

/**
 * Bytes to splice over `link`'s range, or `null` when the edit must be declined. **Every link
 * write path goes through here** (G4.34): a node an inline rung claimed carries no `rewriteLink`
 * hook, so emitting built-in grammar over its bytes would destroy the author's syntax.
 */
export function buildLinkEditBytes(
	link: InlineNode,
	display: string,
	fields: LinkFields,
	resolver?: LinkReferenceResolver
): string | null {
	if (declineClaimed(link, 'edit')) return null;
	return verified(buildLinkSourceBytes(fields), link, display, resolver);
}

/** Bytes that unwrap `link` to the text the reader already sees — remove-link. An autolink has no
 *  brackets to drop, so its removal is the same escape rewrite a re-linking text needs. */
export function buildLinkUnwrapBytes(
	link: InlineNode,
	display: string,
	resolver?: LinkReferenceResolver
): string | null {
	if (declineClaimed(link, 'remove')) return null;
	const [textStart, textEnd] = textRange(link, display);
	const plain = display.slice(textStart, textEnd);
	return verified(escapeRelinkingText(plain, link, display, resolver), link, display, resolver);
}

/** The fields the card edits, read off the source bytes: `url`/`title` are decoded on the node,
 *  but the text and the reference tail must survive as the author wrote them. */
export function linkFieldsFromInline(link: InlineNode, display: string): LinkFields {
	const [textStart, textEnd] = textRange(link, display);
	return {
		text: display.slice(textStart, textEnd),
		url: link.url ?? '',
		...(link.title !== undefined ? { title: link.title } : {}),
		...(link.label !== undefined ? { reference: display.slice(textEnd + 1, link.end) } : {})
	};
}

// ── The GFM serializer ──────────────────────────────────────────────────────

/** The built-in grammar's inverse. Reach it through the seam above, the only caller entitled to
 *  decide these bytes are GFM's to write. */
function buildLinkSourceBytes(fields: LinkFields): string {
	if (fields.reference !== undefined) return `[${fields.text}]${fields.reference}`;
	const title = fields.title !== undefined ? ` "${escapeTitle(fields.title)}"` : '';
	return `[${fields.text}](${encodeDestination(fields.url)}${title})`;
}

// ── Verification ────────────────────────────────────────────────────────────

function declineClaimed(link: InlineNode, what: string): boolean {
	const claim = link.syntaxClaim;
	if (!claim) return false;
	devWarn(
		'link-edit',
		`${what} declined: the "${claim.prefix}" inline rung owns these bytes and registered no link rewriter`
	);
	return true;
}

/** What a reader SEES for `raw`, asked of the thing that paints it. */
function visibleText(raw: string, resolver?: LinkReferenceResolver): string {
	return renderedText(parseInline(raw, 0, raw.length, resolver), raw);
}

/** A candidate is bytes only if splicing it leaves the reader's text untouched — the edit rewrites
 *  a destination nobody saw, so any visible change is the construct having broken. */
function verified(
	candidate: string | null,
	link: InlineNode,
	display: string,
	resolver?: LinkReferenceResolver
): string | null {
	if (candidate === null) return null;
	const before = visibleText(display, resolver);
	const after = visibleText(spliced(candidate, link, display), resolver);
	return before === after ? candidate : null;
}

function spliced(candidate: string, link: InlineNode, display: string): string {
	return display.slice(0, link.start) + candidate + display.slice(link.end);
}

// ── Text ranges and the re-link escape ──────────────────────────────────────

/** The bytes between a construct's opener and its hidden tail: `[…]` for a link, the angle
 *  brackets for an autolink, the whole node for the bare forms. */
function textRange(link: InlineNode, display: string): [number, number] {
	if (link.kind === 'autolink') {
		const angle = display[link.start] === '<' && display[link.end - 1] === '>';
		return angle ? [link.start + 1, link.end - 1] : [link.start, link.end];
	}
	const children = link.children ?? [];
	if (children.length === 0) {
		const close = display.indexOf(']', link.start);
		return [link.start + 1, close === -1 ? link.end : close];
	}
	return [children[0].start, children[children.length - 1].end];
}

const TRIGGER_ESCAPE: readonly [RegExp, string][] = [
	[/^https?:/i, ':'],
	[/^www\./i, '.'],
	[/^[^@]*@/, '@']
];

/**
 * Unwrapping `[www.x.com](u)` hands the bare-autolink pass a match it did not have before, and the
 * link the user removed comes straight back. Escaping the byte that triggers the match kills it
 * without changing one character the reader sees.
 */
function escapeRelinkingText(
	text: string,
	link: InlineNode,
	display: string,
	resolver?: LinkReferenceResolver
): string | null {
	let candidate = text;
	// One pass per surviving autolink; the text is finite and each pass kills one match.
	for (let guard = 0; guard <= text.length; guard++) {
		const offender = relinkedRange(candidate, link, display, resolver);
		if (offender === null) return candidate;
		const escaped = escapeTrigger(candidate, offender);
		if (escaped === null) return null;
		candidate = escaped;
	}
	return null;
}

/** The candidate-relative range of the first link the splice re-created, or null when clean. */
function relinkedRange(
	candidate: string,
	link: InlineNode,
	display: string,
	resolver?: LinkReferenceResolver
): [number, number] | null {
	const raw = spliced(candidate, link, display);
	const end = link.start + candidate.length;
	const found = flattenInline(parseInline(raw, 0, raw.length, resolver)).find(
		(n) => (n.kind === 'link' || n.kind === 'autolink') && n.start < end && n.end > link.start
	);
	if (!found) return null;
	// An offender reaching outside the spliced range is the surrounding text linking with it,
	// which no escape inside the candidate can decide.
	if (found.start < link.start || found.end > end) return null;
	return [found.start - link.start, found.end - link.start];
}

function escapeTrigger(candidate: string, [start, end]: [number, number]): string | null {
	const match = candidate.slice(start, end);
	for (const [form, byte] of TRIGGER_ESCAPE) {
		if (!form.test(match)) continue;
		const at = match.indexOf(byte);
		if (at === -1) return null;
		return candidate.slice(0, start + at) + '\\' + candidate.slice(start + at);
	}
	return null;
}

function flattenInline(nodes: InlineNode[]): InlineNode[] {
	return nodes.flatMap((n) => [n, ...flattenInline(n.children ?? [])]);
}
