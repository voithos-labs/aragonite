/**
 * Code-block renderer. Produces a DocumentFragment with dimmed marker spans
 * for fences and tokenized spans for the body. Invariant:
 *   fragment.textContent === trimTrailingLineEnding(node.raw)
 */

import type { NodeView } from '../../../core/node-views';
import { metadataOf } from '../../../core/nodes';
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

	frag.appendChild(makeMarkerSpan(indent + fenceChars, 'md-fence'));

	const afterFence = openerWithoutNewline.slice(indent.length + fenceChars.length);
	if (afterFence.length > 0) {
		frag.appendChild(makeMarkerSpan(afterFence, 'md-lang'));
	}

	// Trailing opener newline lives as a bare text node, not inside a span:
	// Chromium with `white-space: pre` mis-routes `insertText` when the caret
	// sits at the end of a `\n` nested inside a styled span — the typed char
	// lands BEFORE the \n. Top-level keeps the caret in a position the browser
	// can extend correctly.
	if (hasTrailingNewline) {
		frag.appendChild(document.createTextNode('\n'));
	}

	return frag;
}

function renderCloserLine(slice: FencedCodeSlice): DocumentFragment {
	const frag = document.createDocumentFragment();
	if (slice.closerLine.length === 0) return frag;
	frag.appendChild(makeMarkerSpan(slice.closerLine, 'md-fence'));
	return frag;
}

// ── Top-level render ─────────────────────────────────────────────────────

export function renderCodeBlock(node: NodeView): DocumentFragment {
	const slice = sliceFencedCode(node);
	const meta = metadataOf(node, 'fencedCode');
	const frag = document.createDocumentFragment();

	const openerFrag = renderOpenerLine(slice, meta.fenceMarker, meta.fenceLength);
	const bodyFrag = tokenizeBody(slice.body, slice.infoString);
	const closerFrag = renderCloserLine(slice);

	// Preserve textContent === trimTrailingLineEnding(raw): strip one trailing
	// \n from whichever fragment carries the tail — closer first, then body,
	// then opener (covers the fresh-unclosed case `"```\n"`).
	if (node.raw.endsWith('\n')) {
		stripTrailingNewline(closerFrag) ||
			stripTrailingNewline(bodyFrag) ||
			stripTrailingNewline(openerFrag);
	}

	frag.appendChild(openerFrag);
	frag.appendChild(bodyFrag);
	frag.appendChild(closerFrag);

	return frag;
}

/**
 * Strip one trailing `\n` from the last text-bearing child. Returns true on
 * success so callers can chain priorities. Also removes the now-empty text
 * node so the cursor walker doesn't land in a zero-length node Chromium
 * treats as a non-target.
 */
function stripTrailingNewline(frag: DocumentFragment): boolean {
	const last = frag.lastChild;
	if (last == null || !last.textContent?.endsWith('\n')) return false;
	const trimmed = last.textContent.slice(0, -1);
	if (trimmed.length === 0 && last.nodeType === Node.TEXT_NODE) {
		frag.removeChild(last);
	} else {
		last.textContent = trimmed;
	}
	return true;
}

// ── Internal ─────────────────────────────────────────────────────────────────

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
