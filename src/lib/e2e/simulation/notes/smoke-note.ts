import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The short note the default-suite smoke drives: an intro paragraph, an ATX
 * heading, a bullet list, a list exit, and a closing paragraph. It exercises the
 * full oracle suite — per-char typing with cancelling typos, structural Enter, a
 * list exit (so the always-on nested-state oracle covers that path in CI, the
 * exact shape the harness first caught a desync in), end-state equality,
 * round-trip stability, the undo/redo differential, and a checkpoint — while
 * staying well under the smoke wall-time budget. The headline BIOLOGY_NOTE adds
 * blockquote, fenced code, image resize, task toggle, and a click-back detour.
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
