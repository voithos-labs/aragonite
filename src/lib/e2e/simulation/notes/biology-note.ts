import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The headline note: a cell-division / photosynthesis class note built entirely
 * from HOLD constructs — those a char-by-char gesture build reproduces exactly,
 * so end-state equality (typing ≡ loading) stays a primary oracle. ATX headings
 * only (Enter splits a block, so setext is unreachable by typing); lists, a
 * blockquote, an unclosed fenced code block with auto-close-safe content, a
 * thematic break with a guaranteed preceding blank line, and one image inserted
 * then resized. `expectedMarkdown` is calibrated against the editor, not guessed:
 * loading it and re-serializing yields itself, and it round-trips stably.
 *
 * Two structural Enters need the source-delta `softEnter` rather than the frozen
 * block-host-counting `pressEnter`: a newline inside the code body (the body
 * shares one host) and the collapse that exits a list (it removes a host).
 */
export const BIOLOGY_NOTE: NoteFixture = {
	name: 'biology-note',
	// The unclosed fenced code block below is followed by a summary/divider/image
	// that stay separate live blocks while typing but GFM lazy-collapses into the
	// fence on reload — byte-safe, structurally divergent (docs/issues.md). Exempt
	// from the checkpoint convergence oracle; bytes stay guarded by round-trip +
	// end-state equality.
	unconvergedReason:
		'content typed after an unclosed fenced code block (byte-safe reload-collapse)',
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
		await g.softEnter();
		await g.typeText('---');
		await g.pressEnter();
		await g.softEnter();

		await g.insertImage('chloroplast diagram', '/test-fixtures/sample.png');
		await g.resizeImage('right', 2);
		await g.checkpoint('image-resized', 'image');

		// The checkbox's nearest pathed ancestor is the item's paragraph, not the
		// list item — only the list and the item-paragraphs carry data-block-path.
		await g.toggleTask([7, 0, 0]);
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
	expectedMarkdown:
		'# Cell Division and Photosynthesis\n' +
		'These notes pair **cell division** with *photosynthesis*; run `mitosis()` and skim the [syllabus](https://bio.example/syllabus).\n' +
		'## Mitosis phases\n' +
		'- Prophase condenses the chromosomes\n' +
		'  - Spindle fibers attach at the centromere\n' +
		'- Telophase reforms two nuclei\n' +
		'## Photosynthesis inputs\n' +
		'1. Chloroplasts capture sunlight\n' +
		'2. Water donates electrons\n' +
		'3. Glucose stores the chemical energy\n' +
		'## Study checklist\n' +
		'- [x] Redraw the light reactions\n' +
		'- [ ] Label oxygen as a byproduct\n' +
		'> Remember: oxygen is released, not consumed.\n' +
		'\n' +
		'```\n' +
		'photons = 8\n' +
		'glucose = photons / 8\n' +
		'\n' +
		'Summary follows the divider.\n' +
		'\n' +
		'---\n' +
		'\n' +
		'![chloroplast diagram|440](/test-fixtures/sample.png)\n'
};
