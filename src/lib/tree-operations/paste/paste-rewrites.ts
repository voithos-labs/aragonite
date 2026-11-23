/**
 * The one place a paste's rewrites run. The whole-paste rewrites read every paste first, in plugin
 * list order, before anything reads where it lands (`wholeRewritten`, at the paste entry). Then,
 * wherever the paste lands as blocks (the range-edit core's host, a table cell, the block menu's
 * Replace with clipboard), each plugin value's rewrites by block type, outermost block first, then
 * the process-wide paste transforms. Plain text, the editor's own copy and a program's own insert
 * are never rewritten.
 */
import type { CstNode } from '../../core/nodes';
import type { DocumentView, NodeView } from '../../core/node-views';
import { readBlocks } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { normalizeLineEndings, ownTrailingLineEnding } from '../../core/lines';
import type { GrammarView } from '../../schema/block-openers';
import { rebuildAncestryRaw } from '../../schema/container-raw';
import type { ContributedBlockRewrite } from '../../schema/editor-contributions';
import type { PluginActivation } from '../../schema/plugin-activation';
import type { Doc } from '../../schema/doc-view';
import { cloneNode } from '../clone';
import { applyPasteTransforms } from './paste-transforms';

/** What a paste brings: LF text, whether it goes in as plain text, and the editor's own entry
 *  where the clipboard carried one. */
export interface PastedClip {
	readonly text: string;
	readonly plain: boolean;
	readonly own?: string;
	/** Which of the plugins' paste rewrites read it: every one, `'blocks'` once the whole-paste
	 *  rewrites have, or none (false) for Markdown a program inserts itself. */
	readonly asksRewrites: boolean | 'blocks';
}

/** A clip the whole-paste rewrites have read: what every step past the paste entry takes. */
export type RewrittenClip = PastedClip & { readonly asksRewrites: false | 'blocks' };

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

/** `clip` as the whole-paste rewrites of the plugins `activation` runs leave it, each reading the
 *  paste as the one listed before left it; the same clip where it asks none of them. */
export function wholeRewritten(
	clip: PastedClip,
	activation: PluginActivation,
	grammar: GrammarView
): RewrittenClip {
	if (isRewritten(clip)) return clip;
	const contributions = activation.contributions;
	const listed = contributions?.pasteRewrites ?? [];
	let text = clip.text;
	if (contributions && listed.length > 0 && !clip.plain && clip.own === undefined && text) {
		let read = normalizeLineEndings(text);
		let pasted: Doc | null = null;
		for (const entry of listed) {
			pasted ??= contributions.clipboardRead(readPaste(read, grammar)).doc();
			const out = contributions.answerPaste(entry, pasted);
			if (out === null) continue;
			text = read = normalizeLineEndings(out);
			pasted = null;
			// Nothing is left for a later rewrite to read.
			if (read === '') break;
		}
	}
	return { ...clip, text, asksRewrites: 'blocks' };
}

/** `clip`'s text as the plugins' rewrites leave it: the whole-paste ones where they haven't read
 *  it, then those by type over `read`, the clipboard as blocks; `parts` is the core's join question. */
export function rewrittenPaste(
	clip: PastedClip,
	read: () => DocumentView,
	activation: PluginActivation,
	grammar: GrammarView,
	parts: PartsApart
): string {
	if (!clip.asksRewrites || clip.plain || clip.own !== undefined) return clip.text;
	const whole = wholeRewritten(clip, activation, grammar);
	const blocks = whole.text === clip.text ? read : () => readPaste(whole.text, grammar);
	return applyPasteTransforms(byType(whole.text, blocks, activation, grammar, parts), activation);
}

const isRewritten = (clip: PastedClip): clip is RewrittenClip => clip.asksRewrites !== true;

/** A paste's text read as the blocks of a document of its own. */
const readPaste = (text: string, grammar: GrammarView) =>
	readBlocks(text, { grammar, scope: 'document' });

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
	const pasted = contributions.clipboardRead(clip);
	const claims: { path: number[]; out: string }[] = [];
	const visit = (node: NodeView, path: number[]): void => {
		for (const entry of byKind.get(node.kind) ?? []) {
			const out = contributions.answer(entry, pasted.blockOf(node, path), pasted.doc);
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
