import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The structurally-deep note: a project plan that pushes container nesting and
 * variety the inline-rich note skips — two-level nested bullets, an ordered list
 * with nested ordered sub-items, a mixed checked/unchecked task list, a multi-line
 * blockquote, a fenced code block, several headings, and an image. All HOLD: built
 * char-by-char so end-state equality stays a primary oracle.
 *
 * Nesting follows the biology note's indent/outdent-around-content cadence: type
 * an item at its creation level, `indent` it to nest, then `outdent` the empty
 * trailing item back to top level before typing the next. That shape reaches two
 * levels and no further, which is what this note wants — three-level nesting needs
 * the empty-item cadence (`pressEnter` → `indentEmptyItem` → `typeFreshItem`) and
 * lives in the outline note.
 *
 * Indenting under an ordered item inherits the ordered type, so the nested
 * sub-items are ordered, not bullets — typing a `- ` marker into an ordered item
 * doesn't convert it (it stays literal text). The blockquote is multi-line
 * single-paragraph via `continueQuote`; a true multi-paragraph blockquote
 * (`> p1\n>\n> p2`) isn't reachable by typing.
 */
export const PROJECT_PLAN_NOTE: NoteFixture = {
	name: 'project-plan-note',
	async build(g: Gestures): Promise<void> {
		await g.typeText('# Q3 Editor Project Plan');
		await g.pressEnter();
		await g.typeText('Scope, milestones, and open risks for the next quarter.');
		await g.pressEnter();
		await g.checkpoint('intro', 'heading');

		await g.typeText('## Workstreams');
		await g.pressEnter();
		await g.typeText('- Parser hardening');
		await g.pressEnter();
		await g.typeText('Fuzz the block scanner');
		await g.indent();
		await g.pressEnter();
		await g.outdent();
		await g.typeText('Selection rework and overlays');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('nested-bullets', 'list');

		await g.typeText('## Milestones');
		await g.pressEnter();
		await g.typeText('1. Freeze the CST node model');
		await g.pressEnter();
		await g.typeText('Land the schema seam');
		await g.indent();
		await g.pressEnter();
		await g.outdent();
		await g.typeText('Ship the plugin API');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('ordered-nested', 'list');

		await g.typeText('## Release checklist');
		await g.pressEnter();
		await g.typeText('- [ ] Audit round-trip fixtures');
		await g.pressEnter();
		await g.typeText('Run the simulation suite');
		await g.pressEnter();
		await g.typeText('Tag the release branch');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('task-list', 'task-list');

		await g.startQuote('Risk: the nested-list rewrite touches selection,');
		await g.continueQuote('so we sequence it after the schema seam lands.');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('blockquote', 'blockquote');

		await g.typeText('## Build snippet');
		await g.pressEnter();
		await g.typeText('```');
		await g.softEnter();
		await g.typeText('npm run test:editor');
		await g.softEnter();
		await g.typeText('npm run test:e2e');
		await g.softEnter();
		await g.softEnter();
		await g.checkpoint('code-block', 'code');

		await g.typeText('Reference architecture below.');
		await g.pressEnter();
		await g.softEnter();
		await g.insertImage('architecture diagram', '/test-fixtures/sample.png');
		await g.resizeImage('left', 2);
		await g.checkpoint('image', 'image');

		// The checkbox renders on the item's paragraph; only the list and the
		// item-paragraphs carry data-block-path, so the path stops at the paragraph.
		await g.toggleTask([7, 0, 0]);
	},
	landmarks: [
		'Q3 Editor Project Plan',
		'Workstreams',
		'Parser hardening',
		'Fuzz the block scanner',
		'Selection rework and overlays',
		'Milestones',
		'Freeze the CST node model',
		'Land the schema seam',
		'Ship the plugin API',
		'Release checklist',
		'Audit round-trip fixtures',
		'Risk: the nested-list rewrite',
		'after the schema seam lands',
		'Build snippet',
		'npm run test:e2e',
		'architecture diagram'
	],
	expectedMarkdown:
		'# Q3 Editor Project Plan\n' +
		'Scope, milestones, and open risks for the next quarter.\n' +
		'## Workstreams\n' +
		'- Parser hardening\n' +
		'  - Fuzz the block scanner\n' +
		'- Selection rework and overlays\n' +
		'\n' +
		'## Milestones\n' +
		'1. Freeze the CST node model\n' +
		'   1. Land the schema seam\n' +
		'2. Ship the plugin API\n' +
		'\n' +
		'## Release checklist\n' +
		'- [x] Audit round-trip fixtures\n' +
		'- [ ] Run the simulation suite\n' +
		'- [ ] Tag the release branch\n' +
		'\n' +
		'> Risk: the nested-list rewrite touches selection,\n' +
		'> so we sequence it after the schema seam lands.\n' +
		'\n' +
		'## Build snippet\n' +
		'```\n' +
		'npm run test:editor\n' +
		'npm run test:e2e\n' +
		'```\n' +
		'\n' +
		'Reference architecture below.\n' +
		'\n' +
		'![architecture diagram|360](/test-fixtures/sample.png)\n'
};
