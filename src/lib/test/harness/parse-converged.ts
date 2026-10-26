// The parse-comparison check, offered to unit suites under the name `expectParseConverged`. The
// comparison itself lives in the published testing folder (`testing/parse-convergence.ts`), so
// the kit, this harness and the e2e bridge all share one implementation; that module's header
// says what it replaces and what it tolerates.

import type { CstNode, Document } from '#lib/core/nodes.js';
import type { NodeView } from '#lib/core/node-views.js';
import { endsInBlankLine } from '#lib/core/lines.js';
import { isBlankParagraph, parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { defaultGrammarView, type GrammarView } from '#lib/schema/block-openers.js';
import { fragmentReaderAt } from '#lib/tree-operations/list/task-paragraph.js';

export {
	assertParseConverged as expectParseConverged,
	parseConverges,
	describeConvergence
} from '#lib/testing/parse-convergence.js';

// ── The views the separator suites assert against ────────────────────────────

export const layoutOf = (nodes: readonly CstNode[]): [string, string, string][] =>
	nodes.map((n) => [n.kind, n.leadingTrivia, n.raw]);

export const triviaRawOf = (nodes: readonly CstNode[]): [string, string][] =>
	nodes.map((n) => [n.leadingTrivia, n.raw]);

// ── Blank lines between blocks, against a reload ─────────────────────────────

/** Where the blank lines in a body's gaps first differ from a reload's, a leaf's own trailing blank
 *  line counting toward the gap below it; read only a tree whose shape already converges. */
export function describeRunDivergence(
	doc: Document,
	grammar: GrammarView = defaultGrammarView
): string | null {
	return bodyRunDivergence(doc, parse(serialize(doc), { grammar }), [], grammar);
}

function bodyRunDivergence(
	live: NodeView | Document,
	reloaded: NodeView | Document,
	path: number[],
	grammar: GrammarView
): string | null {
	const liveGaps = gapLines(live, grammar);
	const reloadGaps = gapLines(reloaded, grammar);
	if (liveGaps.join() !== reloadGaps.join()) {
		return `[${path.join(',')}] gap lines ${JSON.stringify(liveGaps)}, reload ${JSON.stringify(reloadGaps)}`;
	}
	const children = live.children ?? [];
	for (let i = 0; i < children.length; i++) {
		if (!children[i].children) continue;
		const divergence = bodyRunDivergence(children[i], reloaded.children![i], [...path, i], grammar);
		if (divergence) return divergence;
	}
	return null;
}

/** Blank lines above the first child, between each pair, and below the last. */
function gapLines(body: NodeView | Document, grammar: GrammarView): number[] {
	const children = body.children ?? [];
	const wrap = body as { innerPrefix?: string; innerSuffix?: string; suffix?: string };
	const prefix = wrap.innerPrefix ?? '';
	const suffix = wrap.suffix ?? wrap.innerSuffix ?? '';
	const gaps = children.map(
		(child, i) =>
			(i > 0 ? leafLine(body, i - 1, grammar) : linesIn(prefix)) + linesIn(child.leadingTrivia)
	);
	gaps.push(leafLine(body, children.length - 1, grammar) + linesIn(suffix));
	return gaps;
}

/** 1 when the leaf at `index` ends in a blank line its reading there leaves out, which counts
 *  toward the gap below it. */
const leafLine = (body: NodeView | Document, index: number, grammar: GrammarView): number => {
	const owner = body.kind === 'document' ? undefined : (body as NodeView);
	const node = body.children?.[index];
	if (!node || node.children || isBlankParagraph(node) || !endsInBlankLine(node.raw)) return 0;
	return fragmentReaderAt(owner, index, grammar)(node.raw).suffix !== '' ? 1 : 0;
};

const linesIn = (text: string): number => (text.match(/\n/g) ?? []).length;
