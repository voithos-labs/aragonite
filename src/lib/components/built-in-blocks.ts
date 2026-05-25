/**
 * Built-in block component registrations. Imported once for side effects from
 * the editor's mount path. Plugin authors mirror this shape for their own kinds.
 *
 * Lives in `components/` rather than `schema/` so the schema layer has no
 * downstream imports — registration is a top-of-DAG wire-up.
 */

import type { CstNode } from '../core/nodes';
import {
	registerBlockComponent,
	type BlockComponentEntry
} from '../schema/block-component-registry';
import TextEditableBlock from './blocks/TextEditableBlock.svelte';
import CodeBlock from './blocks/CodeBlock.svelte';
import ThematicBreakBlock from './blocks/ThematicBreakBlock.svelte';
import BlockquoteBlock from './blocks/BlockquoteBlock.svelte';
import ListBlock from './blocks/ListBlock.svelte';
import TableBlock from './blocks/table/TableBlock.svelte';

function headingExtraProps(node: CstNode): Record<string, unknown> {
	const level = (node.metadata as { level?: number } | undefined)?.level ?? 1;
	return { blockClass: `heading-${level}` };
}

const textAsRawBlock: BlockComponentEntry = {
	component: TextEditableBlock as unknown as BlockComponentEntry['component'],
	extraProps: () => ({ blockClass: 'raw-block' })
};

registerBlockComponent('paragraph', {
	component: TextEditableBlock as unknown as BlockComponentEntry['component'],
	extraProps: () => ({ blockClass: 'paragraph-block' })
});
registerBlockComponent('heading', {
	component: TextEditableBlock as unknown as BlockComponentEntry['component'],
	extraProps: headingExtraProps
});
registerBlockComponent('setextHeading', {
	component: TextEditableBlock as unknown as BlockComponentEntry['component'],
	extraProps: headingExtraProps
});
registerBlockComponent('thematicBreak', {
	component: ThematicBreakBlock as unknown as BlockComponentEntry['component']
});
registerBlockComponent('fencedCode', {
	component: CodeBlock as unknown as BlockComponentEntry['component']
});
registerBlockComponent('blockquote', {
	component: BlockquoteBlock as unknown as BlockComponentEntry['component']
});
registerBlockComponent('list', {
	component: ListBlock as unknown as BlockComponentEntry['component']
});
registerBlockComponent('table', {
	component: TableBlock as unknown as BlockComponentEntry['component']
});

// tableRow / tableCell normally render through TableBlock's own logic — these
// entries are a defensive fallback for orphaned nodes.
registerBlockComponent('indentedCode', textAsRawBlock);
registerBlockComponent('htmlBlock', textAsRawBlock);
registerBlockComponent('linkReferenceDefinition', textAsRawBlock);
registerBlockComponent('tableRow', textAsRawBlock);
registerBlockComponent('tableCell', textAsRawBlock);
registerBlockComponent('unrecognized', textAsRawBlock);
