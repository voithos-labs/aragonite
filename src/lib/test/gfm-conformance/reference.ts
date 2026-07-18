/**
 * commonmark.js is the conformance reference. Exact-pinned: the committed
 * baseline is only meaningful against this version — bumping it is a
 * deliberate re-bless with a changelog note.
 *
 * An input is only readable when the reference's inline stage received exactly
 * the input bytes: a single paragraph whose sourcepos spans the whole input,
 * with nothing for the block layer to trim. Otherwise the comparison is
 * block-layer transforms, not inline conformance, and the input is skipped.
 */
import { Parser, Node } from 'commonmark';

// @types/commonmark omits the option; commonmark.js 0.31.2 supports it.
declare module 'commonmark' {
	interface ParserOptions {
		sourcepos?: boolean;
	}
}

export const REFERENCE_VERSION = '0.31.2';

export type ReferenceSkip = 'not-single-paragraph' | 'partial-span';

const parser = new Parser({ sourcepos: true });

export function referenceInlineReading(
	markdown: string
): { nodes: Node[] } | { skip: ReferenceSkip } {
	const doc = parser.parse(markdown);
	const first = doc.firstChild;
	if (!first || first.type !== 'paragraph' || first.next) {
		return { skip: 'not-single-paragraph' };
	}
	if (!paragraphIsEntireInput(first, markdown)) return { skip: 'partial-span' };
	// A definition carved out of the paragraph at finalize leaves sourcepos
	// spanning the whole block; the parser's own refmap betrays the consumption.
	if (Object.keys((parser as unknown as { refmap: object }).refmap).length > 0) {
		return { skip: 'partial-span' };
	}
	const nodes: Node[] = [];
	for (let child = first.firstChild; child; child = child.next) nodes.push(child);
	return { nodes };
}

export function referenceInlineNodes(markdown: string): Node[] | null {
	const reading = referenceInlineReading(markdown);
	return 'nodes' in reading ? reading.nodes : null;
}

/**
 * Sourcepos alone cannot express "the inline stage saw exactly the input":
 * it counts the raw line, so it includes last-line trailing whitespace the
 * inline parser trims away, and it is blind to the leading whitespace the
 * block layer strips from continuation lines. Those two escapes get explicit
 * checks. A trailing newline fails the span check on purpose — our parser
 * reads it as content bytes, the reference never sees it.
 */
function paragraphIsEntireInput(paragraph: Node, markdown: string): boolean {
	const lines = markdown.split('\n');
	const lastLine = lines[lines.length - 1];
	const [[startLine, startCol], [endLine, endCol]] = paragraph.sourcepos;
	if (startLine !== 1 || startCol !== 1) return false;
	if (endLine !== lines.length || endCol !== lastLine.length) return false;
	if (/[ \t]$/.test(lastLine)) return false;
	return !lines.some((line, i) => i > 0 && /^[ \t]/.test(line));
}
