import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The short note the default suite's smoke test drives. It reaches every check, including
 * leaving a list, which is where this harness first caught state going out of step, and still
 * finishes well inside the smoke test's time budget.
 */
export const SMOKE_NOTE: NoteFixture = {
	name: 'smoke-note',
	async build(g: Gestures): Promise<void> {
		await g.typeText('Photosynthesis converts light energy into chemical energy.');
		await g.pressEnter();
		await g.typeText('## Key players');
		await g.pressEnter();
		await g.typeText('- Chloroplasts capture light');
		await g.pressEnter();
		await g.typeText('Water splits into oxygen');
		await g.pressEnter();
		await g.typeText('Glucose stores the energy');
		await g.pressEnter();
		await g.softEnter();
		await g.typeText('Light and water drive the reaction.');
	},
	landmarks: [
		'Photosynthesis',
		'Key players',
		'Chloroplasts',
		'oxygen',
		'Glucose',
		'drive the reaction'
	],
	// Enter separates blocks, so the note reads the way the gestures type it.
	expectedMarkdown:
		'Photosynthesis converts light energy into chemical energy.\n' +
		'\n' +
		'## Key players\n' +
		'\n' +
		'- Chloroplasts capture light\n' +
		'- Water splits into oxygen\n' +
		'- Glucose stores the energy\n' +
		'\n' +
		'Light and water drive the reaction.\n'
};
