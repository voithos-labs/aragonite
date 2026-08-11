import { describe, it, expect, afterEach, vi } from 'vitest';
import { composeMetadataDoor } from '../../editor-actions/plugin/container';
import { configureEditorEnv, resetEditorEnv } from '../../env';
import type { NodeView } from '../../core/node-views';
import type { PresentationMode } from '../../presentation-mode';

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

afterEach(() => resetEditorEnv());

describe('composeMetadataDoor — the updateOwnMetadata reading gate', () => {
	it('declines the write in reading mode and dev-warns naming the kind', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: true, isTest: false });
		const { door, commit } = makeDoor('reading');

		const result = door({ open: true });

		expect(commit).not.toHaveBeenCalled();
		expect(result).toBeUndefined(); // the declined door reports no pending commit
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy.mock.calls[0][0]).toMatch(/plugin-container/);
		expect(warnSpy.mock.calls[0][0]).toMatch(/reading/);
		expect(warnSpy.mock.calls[0][0]).toMatch(/demo-collapsible/);
		warnSpy.mockRestore();
	});

	it('stays silent in production while still declining', () => {
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		configureEditorEnv({ isDev: false, isTest: false });
		const { door, commit } = makeDoor('reading');

		void door({ open: true });

		expect(commit).not.toHaveBeenCalled();
		expect(warnSpy).not.toHaveBeenCalled();
		warnSpy.mockRestore();
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
