// The standard editor context a block component reads when mounted in isolation.
//
// A bare `mount(SomeBlock, ...)` needs every root-provided context the component
// pulls: the action triple + history (per-key) and the three facets (services,
// policies, document). This assembles that Map with sensible stubs so a test
// mounts one block without hand-enumerating the interface, and re-collapses onto
// it whenever a new required context is added. Override any per-key value or a
// subset of a facet's members through `overrides`.

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
import { defaultRegistryView } from '$lib/schema/registry-view';
import { createEditorEvents } from '$lib/editor-events';
import { createSelectionState } from '$lib/selection/selection-state.svelte';
import { createRevealAnchorState } from '$lib/cursor/reveal-anchor';
import {
	makeStickyColumn,
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

/** Members no current bare mount exercises get a `{}` cast — their real deps
 *  (SearchDeps, DecorationEngineDeps, …) don't belong in a block-mount fixture. */
function stubbedServices(): EditorServices {
	return {
		events: createEditorEvents(),
		decorations: {} as EditorServices['decorations'],
		selection: createSelectionState(),
		search: {} as EditorServices['search'],
		stickyColumn: makeStickyColumn(),
		revealAnchor: createRevealAnchorState(),
		widgetSelection: {} as EditorServices['widgetSelection'],
		controller: {} as EditorServices['controller'],
		pasteCoordinator: {} as EditorServices['pasteCoordinator'],
		reorder: {} as EditorServices['reorder'],
		reorderAnnounce: () => {},
		registryView: defaultRegistryView
	};
}

function stubbedPolicies(): EditorPolicies {
	return {
		resolveImageUrl: (u) => u,
		resolveLinkUrl: (u) => u,
		imageLoadPolicy: () => 'auto',
		blockDragHandles: () => false,
		presentationMode: () => 'source',
		keybindingOverrides: () => ({ global: new Map(), byKind: new Map() }),
		brokenImageUrls: new Set<string>()
	};
}

function stubbedDoc(emptyDoc: Document): EditorDoc {
	return {
		doc: () => emptyDoc,
		linkRef: {},
		pluginEditor: (() => undefined) as unknown as EditorDoc['pluginEditor'],
		lifetime: new AbortController().signal,
		editorRoot: () => null,
		blockElLookup: () => null,
		focusedPath: () => null,
		heightOracle: {} as EditorDoc['heightOracle'],
		widthVersion: () => 0
	};
}

export function editorMountContext(overrides: MountContextOverrides = {}): Map<symbol, unknown> {
	const emptyDoc: Document = { kind: 'document', prefix: '', children: [], suffix: '' };
	return new Map<symbol, unknown>([
		[BLOCK_EDIT_KEY, overrides.blockEdit ?? makeStubBlockEdit()],
		[FOCUS_KEY, overrides.focus ?? makeStubFocus()],
		[HISTORY_KEY, overrides.history ?? { requestUndo: vi.fn(), requestRedo: vi.fn() }],
		[CONTAINER_EDIT_KEY, overrides.containerEdit ?? makeStubContainerEdit()],
		[EDITOR_SERVICES_KEY, { ...stubbedServices(), ...overrides.services }],
		[EDITOR_POLICIES_KEY, { ...stubbedPolicies(), ...overrides.policies }],
		[EDITOR_DOC_KEY, { ...stubbedDoc(emptyDoc), ...overrides.doc }]
	]);
}
