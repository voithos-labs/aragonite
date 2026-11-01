/**
 * Where a link edit becomes bytes: the functions every link write goes through, and under them
 * the GFM serializer. A candidate is written only when the rendered text stays the same, since a
 * destination that breaks its own construct shows up as literal source.
 */

import { constructContentRange, inlineDescendants, readInline } from './index';
import { encodeDestination, escapeTitle } from './destination-bytes';
import type { Reading } from '../../schema/reading';
import { CONTENT_VISIBILITY, renderedText } from './visibility';
import type { InlineNode } from '../nodes';
import type { NodeView } from '../node-views';
import { resolvedInlineContent, type InlineReading } from './inline-cache';
import { recordReferenceWalk } from '../../perf/instruments';
import { devWarn } from '@voithos-labs/aragonite/dev-checks';

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

/** Bytes to splice over `link`'s range, or null when the edit is refused, as on a node a plugin's
 *  inline syntax owns: built-in grammar written over it would destroy that syntax. */
export function buildLinkEditBytes(
	link: InlineNode,
	display: string,
	fields: LinkFields,
	reading: Reading
): string | null {
	if (declineClaimed(link, 'edit')) return null;
	return verified(buildLinkSourceBytes(fields), link.start, link.end, display, reading);
}

/** Bytes that unwrap `link` to the text the user already sees (remove link). An autolink has no
 *  brackets, so its unwrap escapes the byte that would link it again. */
export function buildLinkUnwrapBytes(
	link: InlineNode,
	display: string,
	reading: Reading
): string | null {
	if (declineClaimed(link, 'remove')) return null;
	const [textStart, textEnd] = linkTextRange(link, display);
	const plain = display.slice(textStart, textEnd);
	return verified(
		escapeRelinkingText(plain, link, display, reading),
		link.start,
		link.end,
		display,
		reading
	);
}

/** Bytes that write `[text](url)` over `[start, end)`, or null for an empty url, a range crossing
 *  another construct, or a wrap that changes the render (a `!` before it makes an image). */
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

// ── A reference's label across an edit of its text ──────────────────────────

/** `node`'s bytes with each shortcut or collapsed reference whose text an edit of `range` changes
 *  spelled `[text][label]`, so the label still names its definition; null where none is. */
export function spellReferenceLabels(
	node: NodeView,
	range: { start: number; end: number },
	reading: InlineReading
): { raw: string; map: (offset: number) => number } | null {
	if (!mayHoldReference(node.raw, reading)) return null;
	recordReferenceWalk();
	const labels: { at: number; text: string }[] = [];
	for (const link of inlineDescendants(resolvedInlineContent(node, reading))) {
		if (link.kind !== 'link' || link.label === undefined || link.syntaxClaim) continue;
		const [start, end] = linkTextRange(link, node.raw);
		const tail = node.raw.slice(end + 1, link.end);
		if (tail !== '' && tail !== '[]') continue;
		if (range.start <= link.start && range.end >= link.end) continue;
		const changes =
			range.start === range.end
				? start <= range.start && range.start <= end
				: range.start < end && range.end > start;
		if (!changes) continue;
		const label = node.raw.slice(start, end);
		labels.push(tail === '' ? { at: link.end, text: `[${label}]` } : { at: end + 2, text: label });
	}
	if (labels.length === 0) return null;
	let raw = node.raw;
	for (const { at, text } of [...labels].reverse()) raw = raw.slice(0, at) + text + raw.slice(at);
	const map = (offset: number) =>
		labels.reduce((moved, { at, text }) => (offset >= at ? moved + text.length : moved), offset);
	return { raw, map };
}

/** Whether `raw` can hold a reference at all: a document without definitions has none, which
 *  keeps a keystroke off the walk. */
export const mayHoldReference = (raw: string, reading: InlineReading): boolean =>
	reading.resolverSignature !== '' && raw.includes('[');

const WRAP_SAFE_KINDS: ReadonlySet<string> = new Set(['text', 'escape', 'entityReference']);

/** True when `[start, end)` holds only plain text, so a wrap crosses no other construct. */
export function canWrapRangeAsLink(
	display: string,
	start: number,
	end: number,
	reading: Reading
): boolean {
	if (start >= end || end > display.length) return false;
	return flattenInline(
		readInline(display, 0, display.length, reading.resolver, reading.grammar)
	).every((n) => WRAP_SAFE_KINDS.has(n.kind) || n.end <= start || n.start >= end);
}

/** The fields the link editor edits: `url` and `title` decoded off the node, the text and the
 *  reference tail as the author wrote them. */
export function linkFieldsFromInline(link: InlineNode, display: string): LinkFields {
	const [textStart, textEnd] = linkTextRange(link, display);
	return {
		text: display.slice(textStart, textEnd),
		url: link.url ?? '',
		...(link.title !== undefined ? { title: link.title } : {}),
		...(link.label !== undefined ? { reference: display.slice(textEnd + 1, link.end) } : {})
	};
}

// ── The GFM serializer ──────────────────────────────────────────────────────

/** The built-in grammar's inverse, called only by the functions above, which decide whether the
 *  bytes are GFM's to write. */
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

/** What the user sees for `raw` in the content reading: the link editor may edit a destination
 *  whose markers are on screen, which the block's own reading would count as a visible change. */
function visibleText(raw: string, reading: Reading): string {
	return renderedText(
		readInline(raw, 0, raw.length, reading.resolver, reading.grammar),
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
export function linkTextRange(link: InlineNode, display: string): [number, number] {
	if (link.kind === 'autolink') {
		const text = constructContentRange(link)!;
		return [text.start, text.end];
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

/** Escapes the byte that makes unwrapped text a bare autolink again (`[www.x.com](u)`), so a
 *  removed link stays removed and no visible character changes. */
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
		readInline(raw, 0, raw.length, reading.resolver, reading.grammar)
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
