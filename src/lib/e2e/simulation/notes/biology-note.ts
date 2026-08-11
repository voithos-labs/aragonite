import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The headline note, built entirely from HOLD constructs — those a char-by-char build
 * reproduces exactly, so end-state equality (typing ≡ loading) stays a primary oracle. ATX
 * headings only: Enter splits a block, so setext is unreachable by typing. Two structural
 * Enters need `softEnter` rather than `pressEnter` — a newline in the code body (which shares
 * one host) and the list-exit collapse (which removes one).
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

		await g.startQuote('Remember: oxygen is released, not consumed.');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('blockquote', 'blockquote');

		await g.typeText('```');
		await g.softEnter();
		await g.typeText('photons = 8');
		await g.softEnter();
		await g.typeText('glucose = photons / 8');
		await g.softEnter();
		await g.softEnter();
		await g.checkpoint('code-block', 'code');

		await g.typeText('Summary follows the divider.');
		await g.pressEnter();
		await g.typeText('---');
		await g.pressEnter();

		await g.insertImage('chloroplast diagram', '/test-fixtures/sample.png');
		await g.resizeImage('right', 2);
		await g.checkpoint('image-resized', 'image');

		// The checkbox's nearest pathed ancestor is the item's paragraph, not the
		// list item — only the list and the item-paragraphs carry data-block-path.
		await g.toggleTask([7, 0, 0]);

		// Live mode's own rules over the intro paragraph, which carries every construct they
		// need. Each gesture enters live, drives one rule and undoes it in one press, so the
		// note's canonical end state is what it was before them.
		await g.liveToggleFormat(1, 'notes', 'strikethrough');
		await g.liveEdgeBackspace(1, 'cell division');
		await g.liveLinkCardEdit('syllabus', 'https://bio.example/next');
		// The re-routed caret doors (G2.12): a merge landing's seat, and the list item's Home.
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
	// Enter separates: each heading typed on its own line stands one blank line above what
	// follows, and the break's own Enter is the blank below it.
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
		'- [ ] Label oxygen as a byproduct\n' +
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
