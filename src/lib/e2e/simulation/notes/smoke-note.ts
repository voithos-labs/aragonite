import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The short note the default-suite smoke drives: an intro paragraph, an ATX
 * heading, and a terminal bullet list. It exercises the full oracle suite —
 * per-char typing with cancelling typos, a structural Enter, end-state equality,
 * round-trip stability, the undo/redo differential, and a checkpoint — while
 * staying well under the smoke wall-time budget.
 *
 * Kept short and terminal-list-only so the default `npm test` smoke stays well
 * under its wall-time budget. The headline BIOLOGY_NOTE exercises every HOLD
 * construct (list exits, blockquote, code, image resize, …) in the gated
 * capture spec.
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
	},
	landmarks: ['Photosynthesis', 'Key players', 'Chloroplasts', 'oxygen', 'Glucose'],
	expectedMarkdown:
		'Photosynthesis converts light energy into chemical energy.\n' +
		'## Key players\n' +
		'- Chloroplasts capture light\n' +
		'- Water splits into oxygen\n' +
		'- Glucose stores the energy\n'
};
