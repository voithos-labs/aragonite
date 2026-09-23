/**
 * The e2e bridge's shape (`window.__test`, read through `routes/test/editor/test-probes.ts`).
 * Frozen: every member name and signature is read by the e2e suite, so a change here is a
 * change to hundreds of specs. Each member answers what no public method can.
 */

import type { BlockComponent } from '../block-component';
import type { Document } from '../core/nodes';
import type { HeightOracle } from '../cursor/height-oracle';
import type { OperationsLog } from '../debug/operations-log';
import type { DecorationEngine } from '../decorations/decoration-state.svelte';
import type { RefSlots } from '../reactivity/publish-ref.svelte';
import type { GapCaretPosition } from '../selection/gap-caret';
import type { GrammarView } from '../schema/block-openers';
import type { UndoManager } from '../undo/types';

export interface EditorTestSurface {
	/** The live CST; read-only by contract, since a write bypasses the undo pipeline. */
	getDocument(): Document;
	/** The grammar this editor parses with, so a reload check reads the bytes as the editor does. */
	getGrammar(): GrammarView;
	/** The only place the `source` prop's reset can be observed; it lives in the root. */
	getContentVersion(): number;
	getBlockComponent(path: number[]): BlockComponent | null;
	getUndoStack(): ReturnType<UndoManager['getStacks']>;
	getOperationsLog(): OperationsLog;
	/** The state, not the `data-cross-block` mirror: a deferred `$effect` writes the attribute,
	 *  and an intra-table rectangle keeps one path on both endpoints. */
	isCrossBlockActive(): boolean;
	/** The gap caret has no public selection shape and no paint, so arrival is observable
	 *  only here. */
	getGapCaret(): GapCaretPosition | null;
	/** The engine, not the `addSource`-only registry: its per-path buckets are the only place
	 *  a stale bucket shows, since jsdom measures every range at zero width. */
	getDecorationEngine(): DecorationEngine;
	/** Root-constructed and handed down through context, so its lifetime against a document
	 *  swap cannot be checked headlessly. */
	getHeightOracle(): HeightOracle;
	/** The one value a block list rebuilds off when no id moved. */
	getWidthVersion(): number;
	/** Creates the stale child-ref entry an unmounted block's cleanup can leave behind. */
	setBlockRefSlot: RefSlots<BlockComponent>['set'];
}
