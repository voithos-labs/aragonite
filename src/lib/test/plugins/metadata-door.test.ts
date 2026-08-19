import { describe, it, expect, vi } from 'vitest';
import { composeMetadataDoor } from '$lib/editor-actions/plugin/container';
import { configureEditorEnv } from '$lib/env';
import { takeDevWarns } from '$lib/test/support/warn-gate';
import type { NodeView } from '$lib/core/node-views';
import type { PresentationMode } from '$lib/presentation-mode';

// Miss-analysis: reading-mode inertness was pinned only at the dispatch seams G4.19 scans;
// `updateOwnMetadata` is handed straight to plugin components, and no test drove that one
// plugin-facing byte door under reading mode (GH #38).

const node = { kind: 'demo-collapsible', leadingTrivia: '', raw: '' } as unknown as NodeView;

function makeDoor(mode: PresentationMode) {
	const commit = vi.fn();
	const door = composeMetadataDoor({
		getNode: () => node,
		getPresentationMode: () => mode,
		commit
	});
	return { door, commit };
}

describe('composeMetadataDoor — the updateOwnMetadata reading gate', () => {
	it('declines the write in reading mode and dev-warns naming the kind', () => {
		const { door, commit } = makeDoor('reading');

		const result = door({ open: true });

		expect(commit).not.toHaveBeenCalled();
		expect(result).toBeUndefined(); // the declined door reports no pending commit
		const fires = takeDevWarns();
		expect(fires).toHaveLength(1);
		expect(fires[0].tag).toBe('plugin-container');
		expect(fires[0].message).toMatch(/reading/);
		expect(fires[0].message).toMatch(/demo-collapsible/);
	});

	it('stays silent in production while still declining', () => {
		configureEditorEnv({ isDev: false, isTest: false });
		const { door, commit } = makeDoor('reading');

		void door({ open: true });

		expect(commit).not.toHaveBeenCalled();
		expect(takeDevWarns()).toEqual([]);
	});

	it('commits patch and afterTick untouched outside reading mode', () => {
		const { door, commit } = makeDoor('source');
		const afterTick = () => {};

		void door({ open: false }, afterTick);

		expect(commit).toHaveBeenCalledWith({ open: false }, afterTick);
	});

	// Scoped to reading, not "any non-source mode": preview and live modes edit.
	it('commits in a live preview mode', () => {
		const { door, commit } = makeDoor('preview-block');

		void door({ open: true });

		expect(commit).toHaveBeenCalledTimes(1);
	});
});
