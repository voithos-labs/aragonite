import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The deep-nesting note: three levels in the equality spine, guarding the nesting path the
 * two-level notes cannot reach. Built with the only cadence that breaks that ceiling —
 * `pressEnter` → `indentEmptyItem` → `typeFreshItem` — since indenting a FILLED trailing item
 * does not nest it under its sibling.
 */
export const OUTLINE_NOTE: NoteFixture = {
	name: 'outline-note',
	async build(g: Gestures): Promise<void> {
		await g.typeText('# Field Notes Outline');
		await g.pressEnter();
		await g.typeText('Three levels of structure, typed top-down.');
		await g.pressEnter();
		await g.checkpoint('intro', 'heading');

		await g.typeText('## Observations');
		await g.pressEnter();
		await g.typeText('- Canopy layer');
		await g.pressEnter();
		await g.indentEmptyItem();
		await g.typeFreshItem('Light filters through gaps');
		await g.pressEnter();
		await g.indentEmptyItem();
		await g.typeFreshItem('Epiphytes cluster on high branches');
		await g.pressEnter();
		await g.outdentEmptyItem();
		await g.typeFreshItem('Birdsong dominates at dawn');
		await g.pressEnter();
		await g.outdentEmptyItem();
		await g.typeFreshItem('Understory layer');
		await g.pressEnter();
		await g.indentEmptyItem();
		await g.typeFreshItem('Ferns and saplings compete for light');
		await g.pressEnter();
		await g.outdentEmptyItem();
		await g.softEnter();
		await g.checkpoint('outline', 'list');

		await g.typeText('Detail captured at every depth.');
	},
	landmarks: [
		'Field Notes Outline',
		'Observations',
		'Canopy layer',
		'Light filters through gaps',
		'Epiphytes cluster on high branches',
		'Birdsong dominates at dawn',
		'Understory layer',
		'Ferns and saplings compete for light',
		'Detail captured at every depth'
	],
	expectedMarkdown:
		'# Field Notes Outline\n' +
		'Three levels of structure, typed top-down.\n' +
		'\n' +
		'## Observations\n' +
		'- Canopy layer\n' +
		'  - Light filters through gaps\n' +
		'    - Epiphytes cluster on high branches\n' +
		'  - Birdsong dominates at dawn\n' +
		'- Understory layer\n' +
		'  - Ferns and saplings compete for light\n' +
		'\n' +
		'Detail captured at every depth.\n'
};
