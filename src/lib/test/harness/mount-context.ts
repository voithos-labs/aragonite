// The standard editor context a block component reads when mounted in isolation,
// so a test mounts one block without hand-enumerating the root-provided interface
// and re-collapses onto this file whenever a new required context appears.
// `overrides` takes a per-key value or a subset of a facet's members.

import { vi } from 'vitest';
import {
	BLOCK_EDIT_KEY,
	CONTAINER_EDIT_KEY,
	EDITOR_DOC_KEY,
	EDITOR_POLICIES_KEY,
	EDITOR_SERVICES_KEY,
	FOCUS_KEY,
	HISTORY_KEY,
	type EditorDoc,
	type EditorPolicies,
	type EditorServices
} from '$lib/editor-keys';
import type { BlockEditActions, ContainerEditActions, FocusActions } from '$lib/action-contracts';
import type { Document } from '$lib/core/nodes';
import type { DocumentView } from '$lib/core/node-views';
import { createDecorationEngine } from '$lib/decorations/decoration-state.svelte';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { createLinkCardState } from '$lib/components/link-card/link-card-state.svelte';
import { defaultRegistryView } from '$lib/schema/registry-view';
import { createEditorEvents } from '$lib/editor-events';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createRevealAnchorState } from '$lib/cursor/reveal-anchor';
import { createHeightOracle } from '$lib/cursor/height-oracle';
import { createScrollport, type Scrollport } from '$lib/cursor/scrollport';
import { HEIGHT_ESTIMATES } from '$lib/cursor/typography-estimates';
import {
	makeStickyColumn,
	makeEdgeAffinity,
	makePendingMarks,
	makeStubBlockEdit,
	makeStubContainerEdit,
	makeStubFocus
} from './editor-actions';

interface HistoryStub {
	requestUndo: () => void;
	requestRedo: () => void;
}

export interface MountContextOverrides {
	blockEdit?: BlockEditActions;
	focus?: FocusActions;
	history?: HistoryStub;
	containerEdit?: ContainerEditActions;
	services?: Partial<EditorServices>;
	policies?: Partial<EditorPolicies>;
	/** Facet override; the document getter is the `doc` member (`doc: { doc: () => d }`). */
	doc?: Partial<EditorDoc>;
}

/** A member a bare mount CALLS is wired to its production factory, empty — a
 *  stub that answers only the members reached today drifts the moment a
 *  component reaches one more. The rest keep a `{}` cast. */
function stubbedServices(getDoc: () => DocumentView): EditorServices {
	const selection = createSelectionState();
	return {
		events: createEditorEvents(),
		// Real, not a cast: BlockHost and its overlays call four engine members
		// during mount, and a source-less engine answers all of them honestly.
		decorations: createDecorationEngine({ getDoc }),
		selection,
		search: {} as EditorServices['search'],
		stickyColumn: makeStickyColumn(),
		edgeAffinity: makeEdgeAffinity(),
		pendingMarks: makePendingMarks(),
		revealAnchor: createRevealAnchorState(),
		// Real: every keydown on an editable surface asks it what is selected.
		widgetSelection: createWidgetSelectionState({ onSelect: () => {} }),
		// Real: a `link.openCard` press asks it to seat a target, and the entry rule reads it back.
		// The guards mirror production so a component test exercises the entry gates it ships with.
		linkCard: createLinkCardState({
			onOpen: () => {},
			canOpen: () => !selection.isCrossBlock && window.getSelection()?.isCollapsed !== false,
			canOpenCreate: () => !selection.isCrossBlock && window.getSelection()?.isCollapsed === false
		}),
		// The two members a format toggle reaches on a bare mount; the rest keep the cast.
		controller: {
			flushDebouncedCheckpoint: () => {},
			isolateUndoEntry: (write: () => void) => write()
		} as EditorServices['controller'],
		pasteCoordinator: {} as EditorServices['pasteCoordinator'],
		reorder: {} as EditorServices['reorder'],
		reorderAnnounce: () => {},
		registryView: defaultRegistryView,
		rects: {} as EditorServices['rects']
	};
}

function stubbedPolicies(): EditorPolicies {
	return {
		resolveImageUrl: (u) => u,
		resolveLinkUrl: (u) => u,
		imageLoadPolicy: () => 'auto',
		blockDragHandles: () => false,
		presentationMode: () => 'source',
		theme: () => 'dark',
		keybindingOverrides: () => ({ global: new Map(), byKind: new Map() }),
		onPasteImage: undefined,
		brokenImageUrls: new Set<string>()
	};
}

function stubbedDoc(emptyDoc: Document): EditorDoc {
	// Fresh on every read: a bare mount has no reactive graph to invalidate a
	// derived on, so "always a memo miss" is the only stub that can't hand a
	// consumer a stale answer. A test measuring memo hits supplies its own.
	let version = 0;
	return {
		doc: () => emptyDoc,
		contentVersion: () => ++version,
		linkRef: {},
		pluginEditor: (() => undefined) as unknown as EditorDoc['pluginEditor'],
		lifetime: new AbortController().signal,
		editorRoot: () => null,
		blockElLookup: () => null,
		focusedPath: () => null,
		// Real, not a cast: a windowed container (list, table) builds its height
		// model during init and would throw on a bare object.
		heightOracle: createHeightOracle({
			lineHeight: HEIGHT_ESTIMATES.proseLineHeight,
			codeLineHeight: HEIGHT_ESTIMATES.codeLineHeight,
			avgCharWidth: HEIGHT_ESTIMATES.avgCharWidth,
			blockChrome: HEIGHT_ESTIMATES.blockChrome,
			imageBlockMinHeight: HEIGHT_ESTIMATES.imageBlockMinHeight
		}),
		scrollHost: () => null,
		scrollport: () => null,
		correctsScroll: () => true,
		widthVersion: () => 0,
		viewportHeightVersion: () => 0
	};
}

/** Self mode's own wiring: an editor root supplied without a port IS the port, so a harness
 *  that stubs scroll geometry on the root gets windowing reading it, as in production. */
function withDerivedScrollport(doc: EditorDoc): EditorDoc {
	if (doc.scrollport() !== null) return doc;
	let port: Scrollport | null = null;
	return {
		...doc,
		scrollport: () => {
			const el = doc.editorRoot();
			if (el && !port) port = createScrollport(el);
			return port;
		}
	};
}

export function editorMountContext(overrides: MountContextOverrides = {}): Map<symbol, unknown> {
	const emptyDoc: Document = { kind: 'document', prefix: '', children: [], suffix: '' };
	// The doc facet is assembled first so services that read the document (the
	// decoration engine) see the override rather than the empty placeholder.
	const doc: EditorDoc = withDerivedScrollport({ ...stubbedDoc(emptyDoc), ...overrides.doc });
	return new Map<symbol, unknown>([
		[BLOCK_EDIT_KEY, overrides.blockEdit ?? makeStubBlockEdit()],
		[FOCUS_KEY, overrides.focus ?? makeStubFocus()],
		[HISTORY_KEY, overrides.history ?? { requestUndo: vi.fn(), requestRedo: vi.fn() }],
		[CONTAINER_EDIT_KEY, overrides.containerEdit ?? makeStubContainerEdit()],
		[EDITOR_SERVICES_KEY, { ...stubbedServices(doc.doc), ...overrides.services }],
		[EDITOR_POLICIES_KEY, { ...stubbedPolicies(), ...overrides.policies }],
		[EDITOR_DOC_KEY, doc]
	]);
}
