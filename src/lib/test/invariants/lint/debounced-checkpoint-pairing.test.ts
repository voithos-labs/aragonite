/**
 * G4.51 — a debounced typing checkpoint is half a ceremony. The push opens a batch and the arm
 * opens the window that closes it, and they are deliberately at different points in the keystroke
 * (#71): the arm follows the settle. A caller that pushes and never arms leaves a batch no pause
 * can end, so every later keystroke joins it and one Ctrl+Z unwinds the session.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';

/** The two tiers of the same pair: the controller's own door, and the container forward. */
const PAIRS: { push: RegExp; arm: RegExp; tier: string }[] = [
	{
		push: /\bpushUndoSnapshotDebounced\s*\(/,
		arm: /\barmUndoPause\s*\(/,
		tier: 'controller'
	},
	{
		push: /\bpushDebouncedCheckpoint\s*\(/,
		arm: /\barmDebouncedPause\s*\(/,
		tier: 'container'
	}
];

/** The definition sites: they declare the members rather than spending them as a pair. */
const DECLARATION_SITES = new Set([
	'src/lib/action-contracts.ts',
	'src/lib/editor-actions/commit/undo-controller.ts',
	'src/lib/editor-actions/container-edit.ts'
]);

const unpaired = (sources: SourceFile[], pair: (typeof PAIRS)[number]): string[] =>
	sources
		.filter(
			(file) =>
				!DECLARATION_SITES.has(file.relPath) &&
				pair.push.test(file.code) &&
				!pair.arm.test(file.code)
		)
		.map((file) => file.relPath)
		.sort();

describe('G4.51 every debounced checkpoint is paired with its pause arm', () => {
	// Production sources only: a test legitimately drives one half to observe what it does.
	const sources = collectEditorSources();

	it('inspected a source set that holds the push doors', () => {
		expect(sources.some((f) => PAIRS[0].push.test(f.code))).toBe(true);
		expect(sources.some((f) => PAIRS[1].push.test(f.code))).toBe(true);
	});

	it.each(PAIRS)('the $tier tier: no file pushes without arming', (pair) => {
		expect(
			unpaired(sources, pair),
			'a checkpoint push owes the matching arm once its edit settles (#71)'
		).toEqual([]);
	});

	// Non-vacuity: the scan must fire on the shape it forbids, or it passes by construction.
	it('flags a file that pushes and never arms', () => {
		const synthetic = [
			{ relPath: 'synthetic.ts', code: 'controller.pushUndoSnapshotDebounced([0], 0);' }
		] as SourceFile[];
		expect(unpaired(synthetic, PAIRS[0])).toEqual(['synthetic.ts']);
	});
});
