import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The short note the default-suite smoke drives. It reaches the full oracle suite — including
 * a list exit, the exact shape the harness first caught a desync in — while staying well
 * under the smoke wall-time budget.
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
	expectedMarkdown:
		'Photosynthesis converts light energy into chemical energy.\n' +
		'\n' +
		'## Key players\n' +
		'- Chloroplasts capture light\n' +
		'- Water splits into oxygen\n' +
		'- Glucose stores the energy\n' +
		'\n' +
		'Light and water drive the reaction.\n'
};
