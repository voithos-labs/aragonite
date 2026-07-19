/**
 * Code-block renderer. Produces a DocumentFragment with dimmed marker spans
 * for fences and tokenized spans for the body. Invariant:
 *   fragment.textContent === trimTrailingLineEnding(node.raw)
 */

import type { NodeView } from '../../../core/node-views';
import { metadataOf } from '../../../core/nodes';
import { trimTrailingLineEnding } from '../../../core/lines';
import hljs from 'highlight.js/lib/core';
import { getLanguageGrammar } from './code-languages';

// ── Public API ───────────────────────────────────────────────────────────────

export interface FencedCodeSlice {
	openerLine: string;
	body: string;
	closerLine: string;
	infoString: string;
}

export function sliceFencedCode(node: NodeView): FencedCodeSlice {
	const meta = metadataOf(node, 'fencedCode');
	const raw = node.raw;

	const firstNewline = raw.indexOf('\n');
	if (firstNewline === -1) {
		return { openerLine: raw, body: '', closerLine: '', infoString: meta.info ?? '' };
	}

	const openerLine = raw.slice(0, firstNewline + 1);

	if (!meta.closed) {
		return {
			openerLine,
			body: raw.slice(openerLine.length),
			closerLine: '',
			infoString: meta.info ?? ''
		};
	}

	const closerStart = findClosingFenceStart(
		raw,
		openerLine.length,
		meta.fenceMarker,
		meta.fenceLength
	);
	return {
		openerLine,
		body: raw.slice(openerLine.length, closerStart),
		closerLine: raw.slice(closerStart),
		infoString: meta.info ?? ''
	};
}

// ── hljs class → code-tok class mapping ───────────────────────────────────

const HLJS_CLASS_MAP: Record<string, string> = {
	'hljs-keyword': 'code-tok-keyword',
	'hljs-string': 'code-tok-string',
	'hljs-number': 'code-tok-number',
	'hljs-comment': 'code-tok-comment',
	'hljs-doctag': 'code-tok-comment',
	'hljs-quote': 'code-tok-comment',
	'hljs-type': 'code-tok-type',
	'hljs-class': 'code-tok-type',
	'hljs-name': 'code-tok-type',
	'hljs-selector-tag': 'code-tok-type',
	'hljs-built_in': 'code-tok-function',
	'hljs-function': 'code-tok-function',
	'hljs-title': 'code-tok-function',
	'hljs-variable': 'code-tok-variable',
	'hljs-params': 'code-tok-variable',
	'hljs-template-variable': 'code-tok-variable',
	'hljs-operator': 'code-tok-operator',
	'hljs-punctuation': 'code-tok-punctuation',
	'hljs-tag': 'code-tok-punctuation',
	'hljs-bullet': 'code-tok-punctuation',
	'hljs-meta': 'code-tok-meta',
	'hljs-template-tag': 'code-tok-meta',
	'hljs-literal': 'code-tok-literal',
	'hljs-attr': 'code-tok-attr',
	'hljs-attribute': 'code-tok-attr',
	'hljs-selector-id': 'code-tok-attr',
	'hljs-selector-class': 'code-tok-attr',
	'hljs-selector-pseudo': 'code-tok-attr',
	'hljs-addition': 'code-tok-added',
	'hljs-deletion': 'code-tok-removed',
	'hljs-section': 'code-tok-heading',
	'hljs-link': 'code-tok-link',
	'hljs-regexp': 'code-tok-regexp',
	'hljs-symbol': 'code-tok-symbol',
	'hljs-subst': 'code-tok-subst'
};

export function mapHljsClass(hljsClass: string): string {
	const first = hljsClass.split(/\s+/)[0];
	return HLJS_CLASS_MAP[first] ?? 'code-tok-unknown';
}

// ── hljs output walker ────────────────────────────────────────────────────

export function walkHljsNodes(source: Node, target: DocumentFragment | HTMLElement): void {
	for (const child of source.childNodes) {
		if (child.nodeType === Node.TEXT_NODE) {
			target.appendChild(document.createTextNode(child.textContent ?? ''));
		} else if (child.nodeType === Node.ELEMENT_NODE) {
			const el = child as HTMLElement;
			const span = document.createElement('span');
			span.className = mapHljsClass(el.className);
			walkHljsNodes(el, span);
			target.appendChild(span);
		}
	}
}

// ── Body tokenization ─────────────────────────────────────────────────────

const registeredWithHljs = new Set<string>();

/** `ignoreIllegals` is set so mid-typing invalid syntax doesn't throw. */
export function tokenizeBody(body: string, infoString: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	if (body.length === 0) return frag;

	const grammar = getLanguageGrammar(infoString);
	if (!grammar) {
		frag.appendChild(document.createTextNode(body));
		return frag;
	}

	if (!registeredWithHljs.has(grammar.name)) {
		hljs.registerLanguage(grammar.name, grammar.definition);
		registeredWithHljs.add(grammar.name);
	}

	const result = hljs.highlight(body, {
		language: grammar.name,
		ignoreIllegals: true
	});
	const template = document.createElement('template');
	template.innerHTML = result.value;
	walkHljsNodes(template.content, frag);
	return frag;
}

// ── Fence marker rendering ────────────────────────────────────────────────

function makeMarkerSpan(text: string, extraClass?: string): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = extraClass ? `md-marker ${extraClass}` : 'md-marker';
	span.textContent = text;
	return span;
}

// A fence line's newline is a bare text node CSS cannot reach on its own; wrapping
// the whole line lets reading/preview modes collapse it with `display: none` (the
// `.directive-marker` block-level-span precedent). Layout-neutral in source mode —
// an inline span under `white-space: pre` still breaks on its inner `\n`.
function makeFenceLine(parts: Node[]): HTMLSpanElement {
	const line = document.createElement('span');
	line.className = 'md-fence-line';
	for (const part of parts) line.appendChild(part);
	return line;
}

function renderOpenerLine(
	slice: FencedCodeSlice,
	fenceMarker: '`' | '~',
	fenceLength: number
): DocumentFragment {
	const frag = document.createDocumentFragment();
	if (slice.openerLine.length === 0) return frag;

	const fenceChars = fenceMarker.repeat(fenceLength);
	const openerWithoutNewline = slice.openerLine.replace(/\n$/, '');
	const hasTrailingNewline = slice.openerLine.endsWith('\n');

	// The fence may sit behind 0–3 spaces of indent (BACKTICK_OPEN/TILDE_OPEN).
	// Carry that indent inside the fence-marker span — the closer's house pattern
	// (whole line in one span) — so textContent keeps every opener byte.
	const indent = openerWithoutNewline.match(/^ {0,3}/)![0];

	const parts: Node[] = [makeMarkerSpan(indent + fenceChars, 'md-fence')];

	const afterFence = openerWithoutNewline.slice(indent.length + fenceChars.length);
	if (afterFence.length > 0) {
		parts.push(makeMarkerSpan(afterFence, 'md-lang'));
	}
	if (hasTrailingNewline) {
		parts.push(document.createTextNode('\n'));
	}

	frag.appendChild(makeFenceLine(parts));
	return frag;
}

function renderCloserLine(slice: FencedCodeSlice, leadingNewline: boolean): DocumentFragment {
	const frag = document.createDocumentFragment();
	if (slice.closerLine.length === 0) return frag;

	const parts: Node[] = [];
	// The line break before the closer belongs to the closer's fence line, not the
	// body's last code line; owning it here lets the wrapper hide both together.
	if (leadingNewline) parts.push(document.createTextNode('\n'));
	parts.push(makeMarkerSpan(slice.closerLine, 'md-fence'));

	frag.appendChild(makeFenceLine(parts));
	return frag;
}

// ── Top-level render ─────────────────────────────────────────────────────

export function renderCodeBlock(node: NodeView): DocumentFragment {
	const slice = trimSliceTail(sliceFencedCode(node));
	const meta = metadataOf(node, 'fencedCode');
	const frag = document.createDocumentFragment();

	// The newline separating the body's last line from the closer belongs to the
	// closer's fence line — hand it to the closer wrapper so reading/preview collapse
	// the bottom blank line with the closer. Byte order is unchanged: the same `\n`,
	// only re-homed. An all-blank body is the exception: it has no content line above
	// that blank, so stealing its terminating `\n` would drop a visible line — keep
	// the separator in the body there so N blank lines render as N.
	const hasCloser = slice.closerLine.length > 0;
	const bodyHasContentLine = /\S/.test(slice.body);
	const separatorNewline = hasCloser && slice.body.endsWith('\n') && bodyHasContentLine;
	const bodyText = separatorNewline ? slice.body.slice(0, -1) : slice.body;

	frag.appendChild(renderOpenerLine(slice, meta.fenceMarker, meta.fenceLength));
	frag.appendChild(tokenizeBody(bodyText, slice.infoString));
	frag.appendChild(renderCloserLine(slice, separatorNewline));

	return frag;
}

// ── Internal ─────────────────────────────────────────────────────────────────

// The block's trailing line ending never enters the fragments: strip it from
// whichever slice piece carries the tail (closer, else body, else fresh-unclosed
// opener). textContent === trimTrailingLineEnding(raw) then holds by construction —
// CRLF included, where a post-build single-`\n` strip stranded the `\r`.
function trimSliceTail(slice: FencedCodeSlice): FencedCodeSlice {
	if (slice.closerLine.length > 0)
		return { ...slice, closerLine: trimTrailingLineEnding(slice.closerLine) };
	if (slice.body.length > 0) return { ...slice, body: trimTrailingLineEnding(slice.body) };
	return { ...slice, openerLine: trimTrailingLineEnding(slice.openerLine) };
}

function findClosingFenceStart(
	raw: string,
	searchStart: number,
	fenceMarker: '`' | '~',
	fenceLength: number
): number {
	const fencePattern = new RegExp(`^ {0,3}${escapeRegex(fenceMarker)}{${fenceLength},}\\s*$`);

	let lineEnd = raw.length;
	while (lineEnd > searchStart) {
		const lineStart = raw.lastIndexOf('\n', lineEnd - 2) + 1;
		if (lineStart < searchStart) break;
		const line = raw.slice(lineStart, lineEnd).replace(/\n$/, '');
		if (fencePattern.test(line)) {
			return lineStart;
		}
		lineEnd = lineStart;
	}

	// Unreachable when the parser's `closed` flag is consistent with raw.
	return raw.length;
}

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
