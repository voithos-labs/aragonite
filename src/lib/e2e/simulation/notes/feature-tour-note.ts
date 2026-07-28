import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The inline-rich note: a long-prose "feature tour" that stresses inline-parser
 * variety the structural notes deliberately skip — bold, italic, bold-italic,
 * code spans, multiple links, strikethrough in both tilde forms, bare-URL and
 * bare-email autolinks, HTML entities, backslash escapes, and a
 * trailing-backslash hard line break.
 * Every construct is typed char-by-char (the live parser forms the styled spans),
 * so the whole note is HOLD: end-state equality stays a primary oracle. Headings
 * are ATX only; the lists use single-level bullets and ordered items.
 *
 * The hard break is a paragraph-internal `\` + Enter: the trailing backslash plus
 * the structural Enter keeps both lines in one paragraph (`a\\\nb`), so the build
 * types the first line ending in `\`, presses Enter, and types the continuation.
 */
export const FEATURE_TOUR_NOTE: NoteFixture = {
	name: 'feature-tour-note',
	async build(g: Gestures): Promise<void> {
		await g.typeText('# Inline Feature Tour');
		await g.pressEnter();
		await g.typeText(
			'This tour walks through **bold**, *italic*, and ***bold-italic*** text, plus `inline code` and an [opening link](https://example.com/start).'
		);
		await g.pressEnter();
		await g.checkpoint('intro', 'heading');

		await g.typeText('## Emphasis and code');
		await g.pressEnter();
		await g.typeText(
			'Mix **strong claims** with *soft asides*; combine them as ***both at once*** when a point needs weight.'
		);
		await g.pressEnter();
		await g.typeText(
			'Call `render()` then `commit()`, and cross out ~~the deprecated path~~ or ~the single flag~ so readers skip it.'
		);
		await g.pressEnter();
		await g.checkpoint('emphasis', 'paragraph');

		await g.typeText('## Links and autolinks');
		await g.pressEnter();
		await g.typeText(
			'See the [guide](https://example.com/guide) and the [API notes](https://example.com/api) for details.'
		);
		await g.pressEnter();
		await g.typeText(
			'Bare links autolink too: visit https://example.com/raw or email us at team@example.com directly.'
		);
		await g.pressEnter();
		await g.checkpoint('links', 'paragraph');

		await g.typeText('## Entities and escapes');
		await g.pressEnter();
		await g.typeText(
			'Footer reads &copy; 2026 &mdash; all rights reserved, and the contraction it&#39;s renders cleanly.'
		);
		await g.pressEnter();
		await g.typeText(
			'To show literal markup, escape it: \\*not italic\\*, \\[not a link\\], and a backtick \\` stays plain.'
		);
		await g.pressEnter();
		await g.checkpoint('entities', 'paragraph');

		await g.typeText('## A hard break');
		await g.pressEnter();
		await g.typeText('First half of the thought,\\');
		await g.pressEnter();
		await g.typeText('and the second half on its own visible line.');
		await g.pressEnter();
		await g.checkpoint('hard-break', 'paragraph');

		await g.typeText('## Quick lists');
		await g.pressEnter();
		await g.typeText('- **Skim** the headings first');
		await g.pressEnter();
		await g.typeText('Read the *examples* next');
		await g.pressEnter();
		await g.typeText('Try the `snippets` last');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('bullets', 'list');

		await g.typeText('## Reading order');
		await g.pressEnter();
		await g.typeText('1. Open the [guide](https://example.com/guide)');
		await g.pressEnter();
		await g.typeText('Run every code sample once');
		await g.pressEnter();
		await g.typeText('Note anything ~~unclear~~ confusing');
		await g.pressEnter();
		await g.softEnter();
		await g.typeText('That closes the tour.');
		await g.checkpoint('ordered', 'list');
	},
	landmarks: [
		'Inline Feature Tour',
		'bold-italic',
		'Emphasis and code',
		'the deprecated path',
		'the single flag',
		'Links and autolinks',
		'team@example.com',
		'Entities and escapes',
		'&copy; 2026',
		'A hard break',
		'second half on its own visible line',
		'Quick lists',
		'Reading order',
		'That closes the tour'
	],
	expectedMarkdown:
		'# Inline Feature Tour\n' +
		'This tour walks through **bold**, *italic*, and ***bold-italic*** text, plus `inline code` and an [opening link](https://example.com/start).\n' +
		'## Emphasis and code\n' +
		'Mix **strong claims** with *soft asides*; combine them as ***both at once*** when a point needs weight.\n' +
		'Call `render()` then `commit()`, and cross out ~~the deprecated path~~ or ~the single flag~ so readers skip it.\n' +
		'## Links and autolinks\n' +
		'See the [guide](https://example.com/guide) and the [API notes](https://example.com/api) for details.\n' +
		'Bare links autolink too: visit https://example.com/raw or email us at team@example.com directly.\n' +
		'## Entities and escapes\n' +
		'Footer reads &copy; 2026 &mdash; all rights reserved, and the contraction it&#39;s renders cleanly.\n' +
		'To show literal markup, escape it: \\*not italic\\*, \\[not a link\\], and a backtick \\` stays plain.\n' +
		'## A hard break\n' +
		'First half of the thought,\\\n' +
		'and the second half on its own visible line.\n' +
		'## Quick lists\n' +
		'- **Skim** the headings first\n' +
		'- Read the *examples* next\n' +
		'- Try the `snippets` last\n' +
		'## Reading order\n' +
		'1. Open the [guide](https://example.com/guide)\n' +
		'2. Run every code sample once\n' +
		'3. Note anything ~~unclear~~ confusing\n' +
		'That closes the tour.\n'
};
