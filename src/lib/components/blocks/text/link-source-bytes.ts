/**
 * Where a link edit becomes bytes: the one function every link write goes through (G4.34), and
 * under it the GFM spelling. A candidate is written only once the render says the user sees
 * exactly what they saw before: a destination that breaks its own construct shows up as literal
 * source, which a private scan of the parse tree cannot see.
 */

import { inlineDescendants, parseInline } from '../../../core/inline';
import { encodeDestination, escapeTitle } from '../../../core/inline/destination-bytes';
import type { Reading } from '../../../schema/reading';
import { CONTENT_VISIBILITY, renderedText } from '../../../core/inline/visibility';
import type { InlineNode } from '../../../core/nodes';
import { devWarn } from '../../../dev-warn';

// ── The one write path ──────────────────────────────────────────────────────

export interface LinkFields {
	/** The link text's inner bytes, verbatim. Never re-escaped: the text can hold whole nested
	 *  constructs, and rewriting them from the parse would change bytes the user never touched. */
	text: string;
	url: string;
	title?: string;
	/** Reference forms only: the raw tail after the text's `]` (`[ref]`, `[]`, or empty for the
	 *  shortcut form). Present preserves the reference; absent inlines the destination. */
	reference?: string;
}

/**
 * Bytes to splice over `link`'s range, or `null` when the edit must be refused. Every link write
 * goes through here (G4.34): a node a plugin's inline handler owns carries no `rewriteLink` hook,
 * so writing built-in grammar over its bytes would destroy the author's syntax.
 */
export function buildLinkEditBytes(
	link: InlineNode,
	display: string,
	fields: LinkFields,
	reading: Reading
): string | null {
	if (declineClaimed(link, 'edit')) return null;
	return verified(buildLinkSourceBytes(fields), link.start, link.end, display, reading);
}

/** Bytes that unwrap `link` down to the text the user already sees, which is remove-link. An
 *  autolink has no brackets to drop, so removing it is the escape rewrite a re-linking text needs. */
export function buildLinkUnwrapBytes(
	link: InlineNode,
	display: string,
	reading: Reading
): string | null {
	if (declineClaimed(link, 'remove')) return null;
	const [textStart, textEnd] = textRange(link, display);
	const plain = display.slice(textStart, textEnd);
	return verified(
		escapeRelinkingText(plain, link, display, reading),
		link.start,
		link.end,
		display,
		reading
	);
}

/** Bytes that write `[text](url)` over `[start, end)`, the card's create half. Refuses an empty
 *  destination, a range crossing another construct's bytes, and any candidate the render check
 *  rejects (a neighbouring `!` would turn the wrap into an image). */
export function buildLinkWrapBytes(
	display: string,
	start: number,
	end: number,
	url: string,
	reading: Reading
): string | null {
	if (url.trim() === '' || !canWrapRangeAsLink(display, start, end, reading)) return null;
	// A bare bracket would close the construct early; an existing `\x` pair passes through whole.
	const text = display
		.slice(start, end)
		.replace(/\\[\s\S]|[[\]]/g, (m) => (m.length === 2 ? m : '\\' + m));
	return verified(`[${text}](${encodeDestination(url)})`, start, end, display, reading);
}

const WRAP_SAFE_KINDS: ReadonlySet<string> = new Set(['text', 'escape', 'entityReference']);

/** True when `[start, end)` holds only bytes safe to become link text. Wrapping inside or across
 *  another construct is a policy question create does not answer, so it refuses. */
export function canWrapRangeAsLink(
	display: string,
	start: number,
	end: number,
	reading: Reading
): boolean {
	if (start >= end || end > display.length) return false;
	return flattenInline(
		parseInline(display, 0, display.length, reading.current, reading.grammar)
	).every((n) => WRAP_SAFE_KINDS.has(n.kind) || n.end <= start || n.start >= end);
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

/** The built-in grammar's inverse. Reach it through the functions above, the only callers
 *  entitled to decide these bytes are GFM's to write. */
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
		`${what} declined: the "${claim.prefix}" inline syntax handler owns these bytes and registered no link rewriter`
	);
	return true;
}

/** What the user sees for `raw`, asked of the code that draws it. The content reading, not the
 *  block's own: the card edits a destination whose markers may be on screen, and comparing against
 *  the screen would refuse every such edit as a visible change. The write swaps bytes for bytes
 *  and drops none, so no reading of it can license losing one. */
function visibleText(raw: string, reading: Reading): string {
	return renderedText(
		parseInline(raw, 0, raw.length, reading.current, reading.grammar),
		raw,
		CONTENT_VISIBILITY,
		{ grammar: reading.grammar }
	);
}

/** A candidate becomes bytes only if splicing it over `[start, end)` leaves the visible text
 *  untouched: the write moves bytes nobody saw, so any visible change means the construct broke. */
function verified(
	candidate: string | null,
	start: number,
	end: number,
	display: string,
	reading: Reading
): string | null {
	if (candidate === null) return null;
	const before = visibleText(display, reading);
	const after = visibleText(spliced(candidate, start, end, display), reading);
	return before === after ? candidate : null;
}

function spliced(candidate: string, start: number, end: number, display: string): string {
	return display.slice(0, start) + candidate + display.slice(end);
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
 * without changing one character the user sees.
 */
function escapeRelinkingText(
	text: string,
	link: InlineNode,
	display: string,
	reading: Reading
): string | null {
	let candidate = text;
	// One pass per surviving autolink; the text is finite and each pass kills one match.
	for (let guard = 0; guard <= text.length; guard++) {
		const offender = relinkedRange(candidate, link, display, reading);
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
	reading: Reading
): [number, number] | null {
	const raw = spliced(candidate, link.start, link.end, display);
	const end = link.start + candidate.length;
	const found = flattenInline(
		parseInline(raw, 0, raw.length, reading.current, reading.grammar)
	).find(
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

const flattenInline = (nodes: InlineNode[]): InlineNode[] => [...inlineDescendants(nodes)];
