/**
 * The one place a paste's rewrites run, wherever a paste lands as blocks (the range-edit core's
 * host, a table cell, the block menu's Replace with clipboard): each plugin value's rewrites by
 * block type, outermost block first, then the process-wide paste transforms. Plain text, the
 * editor's own copy and a program's own insert are never rewritten.
 */
import type { CstNode } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import { readBlocks } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { ownTrailingLineEnding } from '../../core/lines';
import type { GrammarView } from '../../schema/block-openers';
import { rebuildAncestryRaw } from '../../schema/container-raw';
import type { ContributedBlockRewrite } from '../../schema/editor-contributions';
import type { PluginActivation } from '../../schema/plugin-activation';
import { cloneNode } from '../clone';
import { applyPasteTransforms } from './paste-transforms';

/** What a paste brings: LF text, whether it goes in as plain text, and the editor's own entry
 *  where the clipboard carried one. */
export interface PastedClip {
	readonly text: string;
	readonly plain: boolean;
	readonly own?: string;
	/** Whether the plugins' paste rewrites read it: false for Markdown a program inserts itself. */
	readonly asksRewrites: boolean;
}

/** One of two blocks left touching: its bytes, and its kind where the asker knows it. */
interface JoinSide {
	readonly raw: string;
	readonly kind?: string;
	readonly children?: readonly unknown[];
}

/** The range-edit core's join question (`RangeHost.parts`): whether children `index` and
 *  `index + 1` of `parent`, left touching, need a blank line to keep their readings. */
export type PartsApart = (
	doc: DocumentView,
	parent: readonly number[],
	index: number,
	upper: JoinSide,
	lower: JoinSide,
	placed: boolean,
	stood: number | null
) => boolean;

/** `clip`'s text as the rewrites of the plugins `activation` runs leave it; `read` is the clipboard
 *  read as blocks, asked only where a rewrite is listed, and `parts` the core's join question. */
export function rewrittenPaste(
	clip: PastedClip,
	read: () => DocumentView,
	activation: PluginActivation,
	grammar: GrammarView,
	parts: PartsApart
): string {
	if (!clip.asksRewrites || clip.plain || clip.own !== undefined) return clip.text;
	return applyPasteTransforms(byType(clip.text, read, activation, grammar, parts), activation);
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** The clipboard being rewritten: its top-level blocks copied, each written block copied whole. */
type Rewritten = Omit<DocumentView, 'children'> & { children: CstNode[] };

/** `text` with each block a rewrite claims written as its answer; `text` itself where none does. */
function byType(
	text: string,
	read: () => DocumentView,
	activation: PluginActivation,
	grammar: GrammarView,
	parts: PartsApart
): string {
	const contributions = activation.contributions;
	const listed = contributions?.blockRewrites ?? [];
	if (!contributions || listed.length === 0) return text;
	const byKind = new Map<string, ContributedBlockRewrite[]>();
	for (const entry of listed) {
		const kind = entry.rewrite.from.name;
		byKind.set(kind, [...(byKind.get(kind) ?? []), entry]);
	}
	const clip = read();
	const blockOf = contributions.clipboardBlocks(clip);
	const claims: { path: number[]; out: string }[] = [];
	const visit = (node: NodeView, path: number[]): void => {
		for (const entry of byKind.get(node.kind) ?? []) {
			const out = contributions.answer(entry, blockOf(node, path));
			if (out !== null) return void claims.push({ path, out });
		}
		node.children?.forEach((child, i) => visit(child, [...path, i]));
	};
	clip.children.forEach((node, i) => visit(node, [i]));
	if (claims.length === 0) return text;
	const rewritten: Rewritten = { ...clip, children: [...clip.children] as CstNode[] };
	// The last claim first, so taking a block out leaves the paths of those before it standing.
	for (const { path, out } of claims.reverse()) written(rewritten, path, out, grammar, parts);
	return serialize(rewritten);
}

/** Writes `out` over the block at `path` in `clip`, with its line ending and its containers'
 *  markers; '' takes it out, and each container then left empty. */
function written(
	clip: Rewritten,
	path: readonly number[],
	out: string,
	grammar: GrammarView,
	parts: PartsApart
): void {
	const tops = clip.children;
	const top = (tops[path[0]] = cloneNode(tops[path[0]]));
	const chain = path.slice(1).reduce((nodes, i) => [...nodes, nodes.at(-1)!.children![i]], [top]);
	let depth = path.length;
	if (out === '') while (depth > 1 && chain[depth - 2].children!.length === 1) depth--;
	const siblings = depth === 1 ? tops : chain[depth - 2].children!;
	const at = path[depth - 1];
	if (out === '') {
		const [gone] = siblings.splice(at, 1);
		// The blank lines between a first block and the next go with it, so the next starts first.
		if (at === 0 && siblings[0])
			siblings[0] = { ...siblings[0], leadingTrivia: gone.leadingTrivia };
	} else {
		const node = siblings[at];
		node.raw = out.replace(/(?:\r?\n)+$/, '') + ownTrailingLineEnding(node.raw);
		const answer = readBlocks(node.raw, { grammar, scope: 'fragment' }).children;
		const [above, below] = [siblings[at - 1], siblings[at + 1]];
		const parent = path.slice(0, depth - 1);
		const blank = ownTrailingLineEnding(node.raw) || '\n';
		const reads = (index: number, upper: JoinSide | undefined, lower: JoinSide | undefined) =>
			!!upper && !!lower && parts(clip, parent, index, upper, lower, true, null);
		// An answer that would read into the block flush beside it stays a block of its own.
		if (!node.leadingTrivia && reads(at - 1, above, answer[0])) node.leadingTrivia = blank;
		if (below && !below.leadingTrivia && reads(at, answer.at(-1), below))
			siblings[at + 1] = { ...below, leadingTrivia: blank };
	}
	if (depth > 1) rebuildAncestryRaw(top, path.slice(1, depth), grammar);
}
