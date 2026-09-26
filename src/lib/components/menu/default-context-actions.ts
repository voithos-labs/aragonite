/**
 * What every non-prose block's context menu offers after the kind's own rows: copy it (its
 * Markdown), replace it with the clipboard, remove it, each named for what the block is
 * ("Remove code block", "Copy image"). Plain, not red: every one is a Ctrl+Z away. Prose blocks
 * are the page's background and take the clipboard rows instead (`editor-root-menus.ts`).
 */
import { blockKindLabel } from '../../a11y-strings';
import type { NodeView } from '../../core/node-views';
import { isImageOnlyParagraph } from '../../core/inline/picture';
import type { InlineReading } from '../../core/inline/inline-cache';
import { EVERY_KIND, registerBuiltinBlockContextActions } from '../../schema/context-actions';

/** The noun the menu uses for a block: its kind's name mid-sentence, and "image" for a
 *  paragraph holding nothing but images. */
export function blockNoun(node: NodeView, reading: InlineReading): string {
	if (isImageOnlyParagraph(node, reading)) return 'image';
	const label = blockKindLabel(node.kind);
	// An initialism keeps its capitals: "HTML block", not "hTML block".
	return /^.[A-Z]/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

let registered = false;

export function registerDefaultContextActions(): void {
	if (registered) return;
	registered = true;
	registerBuiltinBlockContextActions(EVERY_KIND, 'block', (node, _path, noun) => [
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
				const md = ctx.transformPaste(text);
				await ctx.replaceRaw(md.endsWith('\n') ? md : md + '\n');
			}
		},
		{
			id: 'block.remove',
			label: `Remove ${noun}`,
			icon: 'trash',
			run: (ctx) => ctx.deleteBlock()
		}
	]);
}
