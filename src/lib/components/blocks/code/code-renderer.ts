/**
 * Draws a fenced source, a code block's or any plugin kind's that holds its own fence: the fence
 * lines as dimmed markers the marker-hiding modes collapse, the body as its caller paints it. The
 * fragment's text is exactly the source's (G1.28).
 */

import type { NodeView } from '../../../core/node-views';
import { metadataOf } from '../../../core/nodes';
import { displayLines, ownTrailingLineEnding, trimTrailingLineEnding } from '../../../core/lines';
import { fenceAnatomy, type FenceRun } from '../../../core/parsers/fence-syntax';
import { createCaretAnchor } from '../../../cursor/widget-offset';
import { devWarn } from '../../../dev-warn';
import { assertInvariant } from '../../../assert';
import { checkRenderedTextFidelity } from '../../../invariants/render-fidelity';
import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import type { PluginActivation } from '../../../schema/plugin-activation';
import { getLanguageGrammar } from './code-languages';

// ── Public API ───────────────────────────────────────────────────────────────

export interface FencedCodeSlice {
	openerLine: string;
	body: string;
	closerLine: string;
	infoString: string;
}

/** A fenced source split at its fence lines: each line keeps its own ending. */
export interface FencedSource {
	opener: string;
	body: string;
	closer: string;
}

/** `text` split where {@link fenceAnatomy} reads its fence lines; null when it opens no fence. */
export function sliceFencedSource(text: string, fence?: FenceRun): FencedSource | null {
	const anatomy = fenceAnatomy(text, fence);
	if (!anatomy) return null;
	return {
		opener: text.slice(0, anatomy.bodyStart),
		body: text.slice(anatomy.bodyStart, anatomy.closerStart),
		closer: text.slice(anatomy.closerStart)
	};
}

export function sliceFencedCode(node: NodeView): FencedCodeSlice {
	const infoString = metadataOf(node, 'fencedCode').info ?? '';
	const source = sliceFencedSource(node.raw, codeFenceRun(node));
	if (!source) {
		// Not a parse result: a line the grammar reads as no fence is all structure.
		const bodyStart = node.raw.indexOf('\n') + 1 || node.raw.length;
		const openerLine = node.raw.slice(0, bodyStart);
		return { openerLine, body: node.raw.slice(bodyStart), closerLine: '', infoString };
	}
	return { openerLine: source.opener, body: source.body, closerLine: source.closer, infoString };
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

// The definition highlight.js last took under each name, checked against the language registry
// on every read, so a grammar the registry replaced (a reset, a dev-server re-run) replaces here.
const handedToHljs = new Map<string, LanguageFn>();

/** `ignoreIllegals` is set so mid-typing invalid syntax doesn't throw. */
export function tokenizeBody(
	body: string,
	infoString: string,
	activation: PluginActivation
): DocumentFragment {
	const frag = document.createDocumentFragment();
	if (body.length === 0) return frag;

	const grammar = getLanguageGrammar(infoString, activation);
	if (!grammar) {
		frag.appendChild(document.createTextNode(body));
		return frag;
	}

	if (handedToHljs.get(grammar.name) !== grammar.definition) {
		hljs.registerLanguage(grammar.name, grammar.definition);
		handedToHljs.set(grammar.name, grammar.definition);
	}

	// `template.innerHTML` normalizes every `\r\n`/`\r` to `\n`, so a CRLF body is
	// highlighted as pure LF and its endings restored positionally afterward.
	const hasCarriageReturn = body.includes('\r');
	const highlightSource = hasCarriageReturn ? body.replace(/\r\n|\r/g, '\n') : body;

	const result = hljs.highlight(highlightSource, {
		language: grammar.name,
		ignoreIllegals: true
	});
	const template = document.createElement('template');
	template.innerHTML = result.value;
	walkHljsNodes(template.content, frag);

	if (hasCarriageReturn) restoreLineEndings(frag, body);
	return frag;
}

// An in-order text-node walk rewrites the k-th `\n` back to the k-th original ending.
// Counts match by construction: every `\r` was stripped before highlighting, so neither
// hljs nor the HTML parser adds or drops a newline.
function restoreLineEndings(root: Node, originalBody: string): void {
	const endings = originalBody.match(/\r\n|\r|\n/g);
	if (!endings) return;
	let next = 0;
	const restore = (node: Node): void => {
		for (const child of node.childNodes) {
			if (child.nodeType === Node.TEXT_NODE) {
				const text = child.textContent ?? '';
				if (text.includes('\n')) {
					child.textContent = text.replace(/\n/g, () => endings[next++]);
				}
			} else {
				restore(child);
			}
		}
	};
	restore(root);
	// A count mismatch would silently write `undefined` into the committed bytes, so a
	// change in what hljs produces fails loudly here instead.
	if (next !== endings.length) {
		devWarn(
			'code-renderer',
			`restoreLineEndings count mismatch: ${next} fragment newlines vs ${endings.length} source endings`
		);
	}
}

// ── Fenced source rendering ───────────────────────────────────────────────

/**
 * The body as drawn: the line break before the closer belongs to the closer's fence line, so the
 * modes that hide fence lines take the bottom blank line with it. A blank body keeps it, since
 * that break is the only line the caret can sit on.
 */
export function fenceBodyAsDrawn(source: FencedSource): string {
	const ending = ownTrailingLineEnding(source.body);
	const rehomed = source.closer !== '' && ending !== '' && /\S/.test(source.body);
	return rehomed ? source.body.slice(0, -ending.length) : source.body;
}

/** A fenced source as DOM: the fence lines as markers, the body through `paintBody`. */
export function renderFencedSource(
	source: FencedSource,
	paintBody: (body: string) => Node
): DocumentFragment {
	const frag = document.createDocumentFragment();
	const body = fenceBodyAsDrawn(source);
	const separator = source.body.slice(body.length);
	if (source.opener !== '') frag.appendChild(makeFenceLine(openerParts(source.opener)));
	frag.appendChild(paintBody(body));
	// Chromium paints no caret on an empty last body line with only the hidden closer after it, so
	// an anchor holds that line; the modes that paint the closer hide it in CSS.
	if (separator !== '' && body.endsWith('\n')) frag.appendChild(createCaretAnchor('closer'));
	if (source.closer !== '') {
		const parts: Node[] = separator !== '' ? [document.createTextNode(separator)] : [];
		parts.push(makeMarkerSpan(source.closer, 'md-fence'));
		frag.appendChild(makeFenceLine(parts));
	}
	return frag;
}

function makeMarkerSpan(text: string, extraClass: string): HTMLSpanElement {
	const span = document.createElement('span');
	span.className = `md-marker ${extraClass}`;
	span.textContent = text;
	return span;
}

// A fence line's newline is a bare text node CSS cannot reach, so wrapping the whole line lets
// the marker-hiding modes collapse it with `display: none`.
function makeFenceLine(parts: Node[]): HTMLSpanElement {
	const line = document.createElement('span');
	line.className = 'md-fence-line';
	for (const part of parts) line.appendChild(part);
	return line;
}

/** The opener's indent and marker run, then its info string, then its line ending. */
function openerParts(opener: string): Node[] {
	const [{ text, ending }] = displayLines(opener);
	const runEnd = fenceAnatomy(text)?.runEnd ?? text.length;
	const parts: Node[] = [makeMarkerSpan(text.slice(0, runEnd), 'md-fence')];
	if (runEnd < text.length) parts.push(makeMarkerSpan(text.slice(runEnd), 'md-lang'));
	if (ending !== '') parts.push(document.createTextNode(ending));
	return parts;
}

// ── Top-level render ─────────────────────────────────────────────────────

/** `activation` is the editor's, so a language whose plugin it left out renders untokenized. */
export function renderCodeBlock(node: NodeView, activation: PluginActivation): DocumentFragment {
	const display = trimTrailingLineEnding(node.raw);
	const info = metadataOf(node, 'fencedCode').info ?? '';
	const source = sliceFencedSource(display, codeFenceRun(node)) ?? {
		opener: display,
		body: '',
		closer: ''
	};
	const frag = renderFencedSource(source, (body) => tokenizeBody(body, info, activation));

	assertInvariant('rendered-text-fidelity', () =>
		checkRenderedTextFidelity(frag.textContent ?? '', display)
	);

	return frag;
}

// ── Internal ─────────────────────────────────────────────────────────────────

function codeFenceRun(node: NodeView): FenceRun {
	const meta = metadataOf(node, 'fencedCode');
	return { marker: meta.fenceMarker, length: meta.fenceLength };
}
