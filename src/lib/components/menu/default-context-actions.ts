/**
 * What every block's context menu ends with: remove it, named for what it is ("Remove code
 * block", "Remove image"). Plain, not red — it is one Ctrl+Z away. Registered once for every
 * kind, after the kind's own actions, so a code block reads Dissolve, then Remove.
 */
import type { NodeView } from '../../core/node-views';
import { EVERY_KIND, registerBlockContextActions } from '../../schema/context-actions';

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

/** The noun the menu uses for a block: a paragraph holding nothing but an image is "image". */
export function blockNoun(node: NodeView): string {
	if (node.kind === 'paragraph' && IMAGE_ONLY.test(node.raw)) return 'image';
	return KIND_NAMES[node.kind] ?? 'block';
}

let registered = false;

export function registerDefaultContextActions(): void {
	if (registered) return;
	registered = true;
	registerBlockContextActions(EVERY_KIND, (node) => [
		{
			id: 'block.remove',
			label: `Remove ${blockNoun(node)}`,
			icon: 'trash',
			run: (ctx) => ctx.deleteBlock()
		}
	]);
}
