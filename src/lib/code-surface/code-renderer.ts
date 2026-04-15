/**
 * Code-block renderer. Given a fencedCode CstNode, produces a DocumentFragment
 * with dimmed marker spans for the opener/closer lines and tokenized spans for
 * the body (via highlight.js). Invariant:
 *
 *   fragment.textContent === trimTrailingLineEnding(node.raw)
 */

import type { CstNode, FencedCodeMetadata } from '../core/nodes';
import hljs from 'highlight.js/lib/core';
import { getLanguageGrammar } from './code-languages';

// ── Public API ───────────────────────────────────────────────────────────────

export interface FencedCodeSlice {
	openerLine: string;
	body: string;
	closerLine: string;
	infoString: string;
}

/**
 * Split a fencedCode node's raw into opener / body / closer regions using
 * metadata.fenceMarker, metadata.fenceLength, metadata.info, and metadata.closed.
 */
export function sliceFencedCode(node: CstNode): FencedCodeSlice {
	const meta = node.metadata as FencedCodeMetadata;
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

	const closerStart = findClosingFenceStart(raw, openerLine.length, meta.fenceMarker, meta.fenceLength);
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

/** Unknown classes fall through to `code-tok-unknown` — preserves textContent with no color. */
export function mapHljsClass(hljsClass: string): string {
	const first = hljsClass.split(/\s+/)[0];
	return HLJS_CLASS_MAP[first] ?? 'code-tok-unknown';
}

// ── hljs output walker ────────────────────────────────────────────────────

/**
 * Walk parsed hljs HTML, emitting `.code-tok-*` spans. Text nodes pass
 * through; element nodes are renamed via `mapHljsClass`. Recursive for
 * nested spans (e.g. template literal interpolations).
 */
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

/**
 * Tokenize a code-block body via highlight.js. Returns a single-text-node
 * fragment for empty/unknown languages. Uses `ignoreIllegals` so mid-typing
 * invalid syntax does not throw.
 */
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

	frag.appendChild(makeMarkerSpan(fenceChars, 'md-fence'));

	const afterFence = openerWithoutNewline.slice(fenceChars.length);
	if (afterFence.length > 0) {
		frag.appendChild(makeMarkerSpan(afterFence, 'md-lang'));
	}

	if (hasTrailingNewline) {
		frag.appendChild(makeMarkerSpan('\n'));
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

/**
 * Render a fencedCode CST node into a DocumentFragment. Holds the invariant
 * `fragment.textContent === trimTrailingLineEnding(node.raw)`.
 */
export function renderCodeBlock(node: CstNode): DocumentFragment {
	const slice = sliceFencedCode(node);
	const meta = node.metadata as FencedCodeMetadata;
	const frag = document.createDocumentFragment();

	frag.appendChild(renderOpenerLine(slice, meta.fenceMarker, meta.fenceLength));

	const bodyFrag = tokenizeBody(slice.body, slice.infoString);
	const closerFrag = renderCloserLine(slice);

	// Preserve textContent === trimTrailingLineEnding(raw): if raw ends with \n,
	// strip exactly one trailing \n from whichever fragment carries the tail.
	if (node.raw.endsWith('\n')) {
		if (closerFrag.childNodes.length > 0) {
			const lastSpan = closerFrag.lastChild as HTMLSpanElement;
			if (lastSpan.textContent?.endsWith('\n')) {
				lastSpan.textContent = lastSpan.textContent.slice(0, -1);
			}
		} else {
			const last = bodyFrag.lastChild;
			if (last != null && last.textContent?.endsWith('\n')) {
				last.textContent = last.textContent.slice(0, -1);
			}
		}
	}

	frag.appendChild(bodyFrag);
	frag.appendChild(closerFrag);

	return frag;
}

// ── Fence-bump helper (used by CodeBlock paste handler) ──────────────────────

/**
 * Scan `text` for the longest consecutive run of `fenceChar` and return
 * its length. Returns 0 if `fenceChar` does not appear. The CodeBlock paste
 * handler uses this to decide whether the outer fence needs to be bumped
 * in length to keep pasted content from prematurely terminating the block.
 */
export function scanLongestFenceRun(text: string, fenceChar: '`' | '~'): number {
	let longest = 0;
	let current = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === fenceChar) {
			current++;
			if (current > longest) longest = current;
		} else {
			current = 0;
		}
	}
	return longest;
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
