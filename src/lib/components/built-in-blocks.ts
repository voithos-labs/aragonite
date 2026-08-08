/**
 * Built-in block component registrations, applied by an explicit
 * `registerBuiltInBlocks()` call: a bare side-effect import is tree-shaken out of the
 * production build (see built-in-descriptors.ts). Lives in `components/` rather than
 * `schema/` so the schema layer keeps no downstream imports.
 */

import type { NodeView } from '../core/node-views';
import { metadataOf } from '../core/nodes';
import {
	defineBlockComponent,
	registerBlockComponent,
	type BlockComponentEntry
} from '../schema/block-component-registry';
import { augmentBuiltin } from '../schema/block-kind-descriptor';
import { registerBuiltInDescriptors } from '../schema/built-in-descriptors';
import { augmentInlineWidgetKind } from '../core/inline/inline-widgets';
import { registerLiveSplitRebalancer } from '../schema/inline-construct-policy';
import { registerPasteSurface } from '../tree-operations/paste-surfaces';
import { imageWidgetOnSelectedKey } from './image/image-widget-editing';
import { rebalanceLiveSplit } from './blocks/text/live-split-rebalance';
import TextEditableBlock from './blocks/text/TextEditableBlock.svelte';
import CodeBlock from './blocks/code/CodeBlock.svelte';
import ThematicBreakBlock from './blocks/ThematicBreakBlock.svelte';
import BlockquoteBlock from './blocks/BlockquoteBlock.svelte';
import ListBlock from './blocks/list/ListBlock.svelte';
import TableBlock from './blocks/table/TableBlock.svelte';
import { tableCellPasteSurface } from './blocks/table/table-cell-paste';
import { tableCaretAtPoint } from './blocks/table/table-caret-at-point';
import { tableDragHitTest } from './blocks/table/table-drag-hit-test';

function headingExtraProps(node: NodeView): Record<string, unknown> {
	const level = metadataOf(node, 'heading')?.level ?? 1;
	return { blockClass: `heading-${level}` };
}

const textAsRawBlock: BlockComponentEntry = defineBlockComponent(TextEditableBlock, () => ({
	blockClass: 'raw-block'
}));

// Idempotence guard, not a registry bypass: a dev-server re-eval resets it so
// the register-once dev valve still replaces.
let registered = false;

export function registerBuiltInBlocks(): void {
	if (registered) return;
	registered = true;

	// Descriptors first — augmentBuiltin('table') below needs `table` registered.
	registerBuiltInDescriptors();

	registerBlockComponent(
		'paragraph',
		defineBlockComponent(TextEditableBlock, () => ({ blockClass: 'paragraph-block' }))
	);
	registerBlockComponent('heading', defineBlockComponent(TextEditableBlock, headingExtraProps));
	registerBlockComponent(
		'setextHeading',
		defineBlockComponent(TextEditableBlock, headingExtraProps)
	);
	registerBlockComponent('thematicBreak', defineBlockComponent(ThematicBreakBlock));
	registerBlockComponent('fencedCode', defineBlockComponent(CodeBlock));
	registerBlockComponent('blockquote', defineBlockComponent(BlockquoteBlock));
	registerBlockComponent('list', defineBlockComponent(ListBlock));
	registerBlockComponent('table', defineBlockComponent(TableBlock));

	// Raw-editable fallback for kinds with no rendered surface. tableRow/tableCell
	// render inside TableBlock; these catch only orphans that reach BlockHost directly.
	registerBlockComponent('indentedCode', textAsRawBlock);
	registerBlockComponent('htmlBlock', textAsRawBlock);
	registerBlockComponent('linkReferenceDefinition', textAsRawBlock);
	registerBlockComponent('tableRow', textAsRawBlock);
	registerBlockComponent('tableCell', textAsRawBlock);
	registerBlockComponent('unrecognized', textAsRawBlock);

	// tableCell is the one supportsInline kind with bespoke paste semantics, so it
	// registers here and the default loop in paste/hooks.ts skips it — running both
	// would let ordering silently revert cell paste to the plain inline default.
	registerPasteSurface(tableCellPasteSurface);

	// Table owns cell addressing, so it registers both point→cell hooks through the
	// descriptor registry rather than the selection layer importing the component.
	// Two hooks: a drag needs the exact hit and its decline, a caret the nearest cell.
	augmentBuiltin('table', {
		foreignDragHitTest: tableDragHitTest,
		caretTargetAtPoint: tableCaretAtPoint
	});

	// Image resize is editor-layer behavior, so the core image kind stays data-only
	// and gains its selected-key handler here, where the render layer is reachable.
	augmentInlineWidgetKind('image', { onSelectedKey: imageWidgetOnSelectedKey });

	// The split rebalancer needs the inline parser and the render path, neither of which
	// `tree-operations` may import, so the policy table holds the slot and this layer fills it.
	registerLiveSplitRebalancer(rebalanceLiveSplit);
}
