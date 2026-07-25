// A container block mounted BY ITSELF, for probing the ref surface it publishes.
//
// `editorMountContext` alone is not enough for a container: it casts the decoration
// engine and widget selection to `{}`, and every child renders through BlockHost,
// which queries the engine. Both are wired to production objects here — the engine
// registers no sources, so `sourceCount` is 0 and the overlays short-circuit exactly
// as in an editor with no decorations installed, and there is no stub to drift.
//
// For anything that COMMITS, use `editor-mount.ts` instead. A commit replaces the
// container node (copy-path-on-write) and only a real parent re-renders the component
// with the replacement; a bare mount keeps the pre-commit node. This context is for
// read-only questions — what the published `BlockComponent` reports, and what the
// component rendered — where that never comes up.

import type { Document } from '$lib/core/nodes';
import type { EditorServices } from '$lib/editor-keys';
import { createDecorationEngine } from '$lib/decorations/decoration-state.svelte';
import { createWidgetSelectionState } from '$lib/components/image/widget-selection-state.svelte';
import { editorMountContext, type MountContextOverrides } from '../harness/mount-context';

export function containerMountContext(
	getDoc: () => Document,
	overrides: MountContextOverrides = {}
): Map<symbol, unknown> {
	const decorations = createDecorationEngine({ getDoc }) as EditorServices['decorations'];
	return editorMountContext({
		...overrides,
		doc: { doc: getDoc, ...overrides.doc },
		services: {
			decorations,
			widgetSelection: createWidgetSelectionState({ onSelect: () => {} }),
			...overrides.services
		}
	});
}
