/**
 * Draws a fenced source, a code block's or any plugin kind's that holds its own fence: the fence
 * lines as dimmed markers the marker-hiding modes collapse, the body as its caller paints it. The
 * fragment's text is exactly the source's (G1.28).
 */

import type { NodeView } from '../../../core/node-views';
import { metadataOf } from '../../../core/nodes';
import {
	displayLength,
	displayLines,
	ownTrailingLineEnding,
	trimTrailingLineEnding
} from '../../../core/lines';
import { fenceAnatomy, fenceLanguage, type FenceRun } from '../../../core/parsers/fence-syntax';
import { createCaretAnchor } from '../../../browser/painted';
import { assertInvariant } from '@voithos-labs/aragonite/dev-checks';
import { checkRenderedTextFidelity } from '../../../invariants/render-fidelity';
import type { CodePainter } from '../../../schema/code-highlighter';

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

/** The body's bytes in a fenced source, its line ending left out; null when the fence has no
 *  body line yet, as a closer on the line after the opener leaves it. */
export function fencedBodyRange(
	source: FencedSource | null
): { start: number; end: number } | null {
	if (!source || source.body === '') return null;
	const start = source.opener.length;
	return { start, end: start + displayLength(source.body) };
}

/** A code block's {@link fencedBodyRange}. */
export function codeBodyRange(node: NodeView): { start: number; end: number } | null {
	return fencedBodyRange(sliceFencedSource(node.raw, codeFenceRun(node)));
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

// ── Fenced source rendering ───────────────────────────────────────────────

/** The line break before the closer belongs to the closer's fence line, so modes that hide it
 *  take that break too; a blank body keeps it, as the only line the caret can sit on. */
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

/** The body goes through `painter`, the block's own, which knows the editor's highlighters. */
export function renderCodeBlock(node: NodeView, painter: CodePainter): DocumentFragment {
	const display = trimTrailingLineEnding(node.raw);
	const language = fenceLanguage(metadataOf(node, 'fencedCode').info ?? '');
	const source = sliceFencedSource(display, codeFenceRun(node)) ?? {
		opener: display,
		body: '',
		closer: ''
	};
	const frag = renderFencedSource(source, (body) => painter.code(body, language));

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
