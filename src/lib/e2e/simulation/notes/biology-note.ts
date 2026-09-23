import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The main note, built only from constructs that typing reproduces exactly, so the end state
 * still has to match what loading the same markdown gives. `#` headings only: Enter splits a
 * block, so the underlined form cannot be typed. Two of the Enters need `softEnter` instead of
 * `pressEnter`: a newline in the code body, which stays in one block, and leaving the list,
 * which removes one.
 */
export const BIOLOGY_NOTE: NoteFixture = {
	name: 'biology-note',
	async build(g: Gestures): Promise<void> {
		await g.typeText('# Cell Division and Photosynthesis');
		await g.pressEnter();
		await g.typeText(
			'These notes pair **cell division** with *photosynthesis*; run `mitosis()` and skim the [syllabus](https://bio.example/syllabus).'
		);
		await g.pressEnter();
		await g.checkpoint('heading-intro', 'heading');

		await g.typeText('## Mitosis phases');
		await g.pressEnter();
		await g.typeText('- Prophase condenses the chromosomes');
		await g.pressEnter();
		await g.typeText('Spindle fibers attach at the centromere');
		await g.indent();
		await g.pressEnter();
		await g.outdent();
		await g.typeText('Telophase reforms two nuclei');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('mitosis-list', 'list');

		await g.typeText('## Photosynthesis inputs');
		await g.pressEnter();
		await g.typeText('1. Chloroplasts capture sunlight');
		await g.pressEnter();
		await g.typeText('Water donates electrons');
		await g.pressEnter();
		await g.typeText('Glucose stores the chemical energy');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('photosynthesis-list', 'list');

		await g.typeText('## Study checklist');
		await g.pressEnter();
		await g.typeText('- [ ] Redraw the light reactions');
		await g.pressEnter();
		await g.typeText('Label oxygen as a byproduct');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('study-checklist', 'task-list');

		// Picked from the slash list rather than typed as `>`, so the default run covers a pick.
		await g.slashInsert('quote', '> ', 'Remember: oxygen is released, not consumed.');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('blockquote', 'blockquote');

		await g.typeFenceOpener();
		await g.typeText('photons = 8');
		await g.softEnter();
		await g.typeText('glucose = photons / 8');
		await g.softEnter();
		await g.exitFence();
		await g.checkpoint('code-block', 'code');

		await g.typeText('Summary follows the divider.');
		await g.pressEnter();
		await g.typeText('---');
		await g.pressEnter();

		await g.insertImage('chloroplast diagram', '/test-fixtures/sample.png');
		await g.resizeImage('right', 2);
		await g.checkpoint('image-resized', 'image');

		// The nearest ancestor of the checkbox with a path is the item's paragraph, not the list
		// item: only the list and the item paragraphs carry a data-block-path.
		await g.toggleTask([7, 0, 0]);
		await g.toggleTaskByKeyboard([7, 1, 0]);

		// Live mode's own rules, run over the opening paragraph, which holds every construct
		// they need. Each gesture switches into live mode, drives one rule and undoes it in one
		// press, so the note ends up exactly as it was before them.
		await g.liveToggleFormat(1, 'notes', 'strikethrough');
		await g.liveEdgeBackspace(1, 'cell division');
		await g.liveLinkCardEdit('syllabus', 'https://bio.example/next');
		// The two places the editor now places the caret itself (G2.12): after a merge, and on
		// Home in a list item.
		await g.liveMergeLanding(1, 'Photosynthesis', 'These');
		await g.liveListHomeSeat('Prophase condenses the chromosomes');
		await g.checkpoint('live-rules', 'live-editing');
	},
	landmarks: [
		'Cell Division and Photosynthesis',
		'cell division',
		'Mitosis phases',
		'Telophase',
		'Photosynthesis inputs',
		'Glucose stores the chemical energy',
		'oxygen is released',
		'chloroplast diagram'
	],
	// Enter separates blocks: a heading typed on its own line stands one blank line above what
	// follows, and its own Enter provides the blank line below it.
	expectedMarkdown:
		'# Cell Division and Photosynthesis\n' +
		'\n' +
		'These notes pair **cell division** with *photosynthesis*; run `mitosis()` and skim the [syllabus](https://bio.example/syllabus).\n' +
		'\n' +
		'## Mitosis phases\n' +
		'\n' +
		'- Prophase condenses the chromosomes\n' +
		'  - Spindle fibers attach at the centromere\n' +
		'- Telophase reforms two nuclei\n' +
		'\n' +
		'## Photosynthesis inputs\n' +
		'\n' +
		'1. Chloroplasts capture sunlight\n' +
		'2. Water donates electrons\n' +
		'3. Glucose stores the chemical energy\n' +
		'\n' +
		'## Study checklist\n' +
		'\n' +
		'- [x] Redraw the light reactions\n' +
		'- [x] Label oxygen as a byproduct\n' +
		'\n' +
		'> Remember: oxygen is released, not consumed.\n' +
		'\n' +
		'```\n' +
		'photons = 8\n' +
		'glucose = photons / 8\n' +
		'```\n' +
		'\n' +
		'Summary follows the divider.\n' +
		'\n' +
		'---\n' +
		'\n' +
		'![chloroplast diagram|440](/test-fixtures/sample.png)\n'
};
