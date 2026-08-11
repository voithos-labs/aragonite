import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The nested-blockquote note. The `> >` line sits in the equality spine, so end-state equality
 * is what guards the nested-quote-exit path.
 */
export const READING_NOTES_NOTE: NoteFixture = {
	name: 'reading-notes-note',
	async build(g: Gestures): Promise<void> {
		await g.typeText('# Reading Notes: On Style');
		await g.pressEnter();
		await g.typeText('Passages worth keeping, with my own comment nested under each.');
		await g.pressEnter();
		await g.checkpoint('intro', 'heading');

		await g.typeText('## Clarity');
		await g.pressEnter();
		await g.startQuote('Omit needless words.');
		await g.nestQuote('Even the ones that feel load-bearing usually are not.');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('nested-quote', 'blockquote');

		await g.typeText('The nested aside is where the real editing happens.');
	},
	landmarks: [
		'Reading Notes: On Style',
		'Passages worth keeping',
		'Clarity',
		'Omit needless words',
		'load-bearing usually are not',
		'real editing happens'
	],
	expectedMarkdown:
		'# Reading Notes: On Style\n' +
		'\n' +
		'Passages worth keeping, with my own comment nested under each.\n' +
		'\n' +
		'## Clarity\n' +
		'\n' +
		'> Omit needless words.\n' +
		'>\n' +
		'> > Even the ones that feel load-bearing usually are not.\n' +
		'\n' +
		'The nested aside is where the real editing happens.\n'
};
