/**
 * The one place a paste's rewrites run, wherever a paste lands as blocks (the range-edit core's
 * host, a table cell, the block menu's Replace with clipboard): each plugin value's rewrites by
 * block type, outermost block first, then the process-wide paste transforms. Plain text, the
 * editor's own copy and a program's own insert are never rewritten.
 */
import type { CstNode } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import { serialize } from '../../core/serializer';
import { ownTrailingLineEnding } from '../../core/lines';
import type { GrammarView } from '../../schema/block-openers';
import { rebuildAncestryRaw } from '../../schema/container-raw';
import type { ContributedRewrite } from '../../schema/editor-contributions';
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

/** `clip`'s text as the rewrites of the plugins `activation` runs leave it; `read` is the clipboard
 *  read as blocks, asked only where a rewrite is listed. */
export function rewrittenPaste(
	clip: PastedClip,
	read: () => DocumentView,
	activation: PluginActivation,
	grammar: GrammarView
): string {
	if (!clip.asksRewrites || clip.plain || clip.own !== undefined) return clip.text;
	return applyPasteTransforms(byType(clip.text, read, activation, grammar), activation);
}

// ── Internal ─────────────────────────────────────────────────────────────────

/** `text` with each block a rewrite claims written as its answer; `text` itself where none does. */
function byType(
	text: string,
	read: () => DocumentView,
	activation: PluginActivation,
	grammar: GrammarView
): string {
	const contributions = activation.contributions;
	const listed = contributions?.rewrites ?? [];
	if (!contributions || listed.length === 0) return text;
	const byKind = new Map<string, ContributedRewrite[]>();
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
	const tops = [...clip.children] as CstNode[];
	// The last claim first, so taking a block out leaves the paths of those before it standing.
	for (const { path, out } of claims.reverse()) written(tops, path, out, grammar);
	return serialize({ prefix: clip.prefix, children: tops, suffix: clip.suffix });
}

/** Writes `out` over the block at `path` in `tops`, the clipboard's top-level blocks copied, with its
 *  line ending and its containers' markers; '' takes it out, and each container then left empty. */
function written(
	tops: CstNode[],
	path: readonly number[],
	out: string,
	grammar: GrammarView
): void {
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
	}
	if (depth > 1) rebuildAncestryRaw(top, path.slice(1, depth), grammar);
}
