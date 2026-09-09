/**
 * What every non-prose block's context menu offers after the kind's own rows: copy it (its
 * Markdown), replace it with the clipboard, remove it — each named for what the block is
 * ("Remove code block", "Copy image"). Plain, not red: every one is a Ctrl+Z away. Prose blocks
 * are the page's background and keep the browser's own menu (`Editor.svelte`).
 */
import type { NodeView } from '../../core/node-views';
import { EVERY_KIND, registerBlockContextActions } from '../../schema/context-actions';
import { applyPasteTransforms } from '../../tree-operations/paste/paste-transforms';

const KIND_NAMES: Record<string, string> = {
	paragraph: 'paragraph',
	heading: 'heading',
	setextHeading: 'heading',
	fencedCode: 'code block',
	indentedCode: 'code block',
	mathBlock: 'math block',
	mathFence: 'math block',
	table: 'table',
	blockquote: 'quote',
	list: 'list',
	thematicBreak: 'divider',
	html: 'HTML block',
	linkReferenceDefinition: 'link definition'
};

const IMAGE_ONLY = /^\s*!\[[^\]]*\]\([^)]*\)\s*$/;
const PROSE_KINDS: ReadonlySet<string> = new Set(['paragraph', 'heading', 'setextHeading']);

/** The noun the menu uses for a block: a paragraph holding nothing but an image is "image". */
export function blockNoun(node: NodeView): string {
	if (node.kind === 'paragraph' && IMAGE_ONLY.test(node.raw)) return 'image';
	return KIND_NAMES[node.kind] ?? 'block';
}

/** Prose is the page's background: it takes no block menu of its own. An image alone in a
 *  paragraph is a block, not prose. */
export function isProseBackground(node: NodeView): boolean {
	return PROSE_KINDS.has(node.kind) && blockNoun(node) !== 'image';
}

let registered = false;

export function registerDefaultContextActions(): void {
	if (registered) return;
	registered = true;
	registerBlockContextActions(EVERY_KIND, (node) => {
		const noun = blockNoun(node);
		return [
			{
				id: 'block.copy',
				label: `Copy ${noun}`,
				icon: 'copy',
				run: () => navigator.clipboard.writeText(node.raw)
			},
			{
				id: 'block.replace',
				label: 'Replace with clipboard',
				icon: 'clipboard',
				run: async (ctx) => {
					let text: string;
					try {
						text = await navigator.clipboard.readText();
					} catch {
						return;
					}
					if (text.trim() === '') return;
					// The paste transforms first, as any paste gets, so a plugin's rewrite applies.
					const md = applyPasteTransforms(text);
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
	});
}
