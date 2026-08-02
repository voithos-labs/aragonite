import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The meeting-minutes note. All HOLD, so end-state equality stays a primary oracle. The
 * nested action item uses the empty-item cadence, putting a task and its sub-action one level
 * apart in the equality spine.
 */
export const MEETING_MINUTES_NOTE: NoteFixture = {
	name: 'meeting-minutes-note',
	async build(g: Gestures): Promise<void> {
		await g.typeText('# Sprint Sync — June 1');
		await g.pressEnter();
		await g.typeText('## Attendees');
		await g.pressEnter();
		await g.typeText('- Dana (facilitator)');
		await g.pressEnter();
		await g.typeText('Lee (notes)');
		await g.pressEnter();
		await g.typeText('Priya (eng)');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('attendees', 'list');

		await g.typeText('## Decision');
		await g.pressEnter();
		await g.startQuote('Ship the editor beta behind a flag this week.');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('decision', 'blockquote');

		await g.typeText('## Agenda');
		await g.pressEnter();
		await g.typeText('1. Review last sprint');
		await g.pressEnter();
		await g.typeText('Triage the bug backlog');
		await g.pressEnter();
		await g.typeText('Plan the beta rollout');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('agenda', 'list');

		await g.typeText('## Action items');
		await g.pressEnter();
		await g.typeText('- [ ] Dana drafts the rollout note');
		await g.pressEnter();
		await g.indentEmptyItem();
		await g.typeFreshItem('Circulate for review by Thursday');
		await g.pressEnter();
		await g.outdentEmptyItem();
		await g.typeFreshItem('Priya wires the feature flag');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('action-items', 'task-list');

		await g.typeText('Notes archived after the sync.');
	},
	landmarks: [
		'Sprint Sync — June 1',
		'Attendees',
		'Dana (facilitator)',
		'Priya (eng)',
		'Decision',
		'Ship the editor beta behind a flag',
		'Agenda',
		'Triage the bug backlog',
		'Action items',
		'Dana drafts the rollout note',
		'Circulate for review by Thursday',
		'Priya wires the feature flag',
		'Notes archived after the sync'
	],
	// Enter separates (0.9.36), so a heading typed on its own line stands one blank line above
	// what follows it — the note is written the way it is typed, which is what the oracle asks.
	expectedMarkdown:
		'# Sprint Sync — June 1\n' +
		'\n' +
		'## Attendees\n' +
		'\n' +
		'- Dana (facilitator)\n' +
		'- Lee (notes)\n' +
		'- Priya (eng)\n' +
		'\n' +
		'## Decision\n' +
		'\n' +
		'> Ship the editor beta behind a flag this week.\n' +
		'\n' +
		'## Agenda\n' +
		'\n' +
		'1. Review last sprint\n' +
		'2. Triage the bug backlog\n' +
		'3. Plan the beta rollout\n' +
		'\n' +
		'## Action items\n' +
		'\n' +
		'- [ ] Dana drafts the rollout note\n' +
		'  - [ ] Circulate for review by Thursday\n' +
		'- [ ] Priya wires the feature flag\n' +
		'\n' +
		'Notes archived after the sync.\n'
};
