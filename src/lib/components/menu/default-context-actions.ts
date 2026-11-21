/**
 * What a non-prose block's context menu offers: its kind's own rows and its plugin type's, then
 * copy it (its Markdown), replace it with the clipboard and remove it, each named for what the block is ("Remove code
 * block", "Copy image"). Plain, not red: every one is a Ctrl+Z away. Prose blocks are the page's
 * background and take the clipboard rows instead (`editor-root/menus.ts`).
 */
import { blockKindLabel } from '../../a11y-strings';
import type { LineEnding } from '../../core/lines';
import type { BlockKind } from '../../core/nodes';
import type { NodeView } from '../../core/node-views';
import { pictureImageCount } from '../../core/inline/picture';
import type { InlineReading } from '../../core/inline/inline-cache';
import type { Icon } from '../../menu-icons';
import { copyBlockToClipboard, readClipboard, type ClipboardRead } from '../../browser/clipboard';
import { codeBlockActions } from '../blocks/code/code-context-actions';

export interface BlockActionContext {
	node: NodeView;
	/** The block's path from the document root. Top-level blocks only, for now. */
	path: number[];
	deleteBlock(): Promise<void>;
	/** Replaces the block's bytes as one undo step, every line break in the document's ending;
	 *  false, writing nothing, if the block changed since its row was picked. */
	replaceRaw(raw: string): Promise<boolean>;
	/** The document's line ending, for a line rebuilt from the block's own bytes. */
	lineEnding: LineEnding;
	/** A clipboard read's text as the paste rewrites of the plugins this editor lists leave it. */
	transformPaste(clip: ClipboardRead): string;
}

export interface BlockContextAction {
	id: string;
	label: string;
	icon?: Icon;
	disabled?: boolean;
	run(ctx: BlockActionContext): void | Promise<unknown>;
}

/** The noun the menu uses for a block: its kind's name mid-sentence, and "image" or "images"
 *  for a paragraph holding nothing but images. */
export function blockNoun(node: NodeView, reading: InlineReading): string {
	const images = pictureImageCount(node, reading);
	if (images > 0) return images === 1 ? 'image' : 'images';
	const label = blockKindLabel(node.kind);
	// An initialism keeps its capitals: "HTML block", not "hTML block".
	return /^.[A-Z]/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

/** The rows a right-click on `node` offers, read on every open so they see the block as it is;
 *  `typeRows` are its plugin type's, between its kind's rows and the rows every block has. */
export function blockActionsFor(
	node: NodeView,
	noun: string,
	typeRows: readonly BlockContextAction[]
): BlockContextAction[] {
	const kindRows = KIND_ROWS[node.kind as BlockKind]?.(node) ?? [];
	return [...kindRows, ...typeRows, ...everyBlockRows(node, noun)];
}

// ── Internal ─────────────────────────────────────────────────────────────────

const KIND_ROWS: Partial<Record<BlockKind, (node: NodeView) => BlockContextAction[]>> = {
	fencedCode: codeBlockActions
};

function everyBlockRows(node: NodeView, noun: string): BlockContextAction[] {
	return [
		{
			id: 'block.copy',
			label: `Copy ${noun}`,
			icon: 'copy',
			run: async () => {
				await copyBlockToClipboard({ text: node.raw });
			}
		},
		{
			id: 'block.replace',
			label: 'Replace with clipboard',
			icon: 'clipboard',
			run: async (ctx) => {
				const clip = await readClipboard();
				if (!clip || clip.text.trim() === '') return;
				// Rewritten as Ctrl+V rewrites it: never the editor's own copy.
				const md = ctx.transformPaste(clip);
				if (md.trim() === '') return;
				await ctx.replaceRaw(md.endsWith('\n') ? md : md + '\n');
			}
		},
		{
			id: 'block.remove',
			label: `Remove ${noun}`,
			icon: 'trash',
			run: (ctx) => ctx.deleteBlock()
		}
	];
}
