/**
 * Built-in block component registrations. Imported for side effects — the
 * `import` populates the registry idempotently. Plugin authors mirror this
 * shape for their own kinds.
 */

import type { CstNode } from '../core/nodes';
import TextEditableBlock from '../components/blocks/TextEditableBlock.svelte';
import CodeBlock from '../components/blocks/CodeBlock.svelte';
import ThematicBreakBlock from '../components/blocks/ThematicBreakBlock.svelte';
import BlockquoteBlock from '../components/blocks/BlockquoteBlock.svelte';
import ListBlock from '../components/blocks/ListBlock.svelte';
import TableBlock from '../components/blocks/table/TableBlock.svelte';
import { registerBlockComponent, type BlockComponentEntry } from './block-component-registry';

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

// Kinds rendered via TextEditableBlock's raw-block surface (contenteditable on
// `raw`, no inline parsing / marker styling). Two categories share this entry:
//   - Permanent fallbacks (indentedCode, htmlBlock, linkReferenceDefinition):
//     stay raw-editable as the final shape; no dedicated component is planned.
//     The visible quality gap vs fenced code / inline content is the design
//     choice. LRD additionally gets distinct CSS via the data-block-kind
//     attribute on BlockHost (see 0.6.6.1 changelog).
//   - Placeholders (tableRow, tableCell, unrecognized): tableRow / tableCell
//     normally render through TableBlock's own logic — the registration here
//     is a defensive fallback for orphaned nodes. `unrecognized` graduates to
//     its own kind when parser support for the syntax is added.
registerBlockComponent('indentedCode', textAsRawBlock);
registerBlockComponent('htmlBlock', textAsRawBlock);
registerBlockComponent('linkReferenceDefinition', textAsRawBlock);
registerBlockComponent('tableRow', textAsRawBlock);
registerBlockComponent('tableCell', textAsRawBlock);
registerBlockComponent('unrecognized', textAsRawBlock);
