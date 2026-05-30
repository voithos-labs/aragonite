import type { Gestures } from '../gestures';

export interface NoteFixture {
	name: string;
	build(g: Gestures): Promise<void>;
	expectedMarkdown: string;
}

/**
 * Phase-1 stub: a single paragraph plus a three-item bullet list, built from
 * HOLD-only constructs so a char-by-char gesture build reproduces the source
 * exactly (typing ≡ loading). Phase 2 (Batch D) expands this into the full
 * cell-division class note. `expectedMarkdown` is the canonical source the
 * finished note serializes to — calibrated against the editor, not hand-set.
 */
export const BIOLOGY_NOTE: NoteFixture = {
	name: 'biology-note',
	async build(g: Gestures): Promise<void> {
		await g.typeText('Photosynthesis converts light energy into chemical energy.');
		await g.pressEnter();
		await g.typeText('- Chloroplasts capture light');
		await g.pressEnter();
		await g.typeText('Water splits into oxygen');
		await g.pressEnter();
		await g.typeText('Glucose stores the energy');
	},
	expectedMarkdown:
		'Photosynthesis converts light energy into chemical energy.\n' +
		'- Chloroplasts capture light\n' +
		'- Water splits into oxygen\n' +
		'- Glucose stores the energy\n'
};
