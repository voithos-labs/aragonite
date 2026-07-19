/**
 * Built-in block component registrations, applied by an explicit
 * `registerBuiltInBlocks()` call from the editor's mount path — a bare
 * side-effect import is tree-shaken out of the production Rollup build (see
 * built-in-descriptors.ts). Plugin authors mirror this shape for their own
 * kinds.
 *
 * Lives in `components/` rather than `schema/` so the schema layer has no
 * downstream imports — registration is a top-of-DAG wire-up.
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
import { registerPasteSurface } from '../tree-operations/paste-surfaces';
import { imageWidgetOnSelectedKey } from './image/image-widget-editing';
import TextEditableBlock from './blocks/text/TextEditableBlock.svelte';
import CodeBlock from './blocks/code/CodeBlock.svelte';
import ThematicBreakBlock from './blocks/ThematicBreakBlock.svelte';
import BlockquoteBlock from './blocks/BlockquoteBlock.svelte';
import ListBlock from './blocks/list/ListBlock.svelte';
import TableBlock from './blocks/table/TableBlock.svelte';
import { tableCellPasteSurface } from './blocks/table/table-cell-paste';
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

	// Raw-editable fallback for kinds with no dedicated rendered surface.
	// tableRow / tableCell normally render inside TableBlock — these entries only
	// catch orphaned nodes that reach BlockHost directly.
	registerBlockComponent('indentedCode', textAsRawBlock);
	registerBlockComponent('htmlBlock', textAsRawBlock);
	registerBlockComponent('linkReferenceDefinition', textAsRawBlock);
	registerBlockComponent('tableRow', textAsRawBlock);
	registerBlockComponent('tableCell', textAsRawBlock);
	registerBlockComponent('unrecognized', textAsRawBlock);

	// tableCell is the one supportsInline kind with bespoke paste semantics, so its
	// surface registers here rather than via the default loop in paste/hooks.ts
	// (which skips it). Pipe-escaping cell paste would silently revert to the plain
	// inline default if both registrars ran and order let the default win.
	registerPasteSurface(tableCellPasteSurface);

	// Table owns internal cell addressing, so it registers a foreign-drag hit-test
	// the selection layer dispatches through the descriptor registry — no
	// selection→table-component import.
	augmentBuiltin('table', { foreignDragHitTest: tableDragHitTest });

	// Image resize is editor-layer behavior; the core image kind stays data-only and
	// gains its selected-key handler here, where the DOM/render layer is reachable.
	augmentInlineWidgetKind('image', { onSelectedKey: imageWidgetOnSelectedKey });
}
