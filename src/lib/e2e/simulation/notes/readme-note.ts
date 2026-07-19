import type { Gestures } from '../gestures';
import type { NoteFixture } from './types';

/**
 * The README note: a getting-started doc genre — a heading, a link-bearing intro,
 * an ordered install/run sequence, a fenced code block of commands, and a links
 * section. All HOLD (typed char by char), so end-state equality stays primary.
 * The ordered steps, the fenced code body (via `softEnter`), and the inline links
 * each land in the equality spine. Headings are ATX only; the code fence stays
 * unclosed with auto-close-safe content, matching the other code-bearing notes.
 */
export const README_NOTE: NoteFixture = {
	name: 'readme-note',
	// Types a Links section after an unclosed fenced code block: those blocks stay
	// separate while typing but GFM lazy-collapses them into the fence on reload —
	// byte-safe, structurally divergent (docs/issues.md). Exempt from the checkpoint
	// convergence oracle; round-trip + end-state equality still guard the bytes.
	unconvergedReason:
		'content typed after an unclosed fenced code block (byte-safe reload-collapse)',
	async build(g: Gestures): Promise<void> {
		await g.typeText('# Limestone CLI');
		await g.pressEnter();
		await g.typeText(
			'A local-first notes tool. See the [docs](https://example.com/docs) to start.'
		);
		await g.pressEnter();
		await g.checkpoint('intro', 'heading');

		await g.typeText('## Quick start');
		await g.pressEnter();
		await g.typeText('1. Clone the repo');
		await g.pressEnter();
		await g.typeText('Install with `npm install`');
		await g.pressEnter();
		await g.typeText('Launch the dev build');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('steps', 'list');

		await g.typeText('## Commands');
		await g.pressEnter();
		await g.typeText('```');
		await g.softEnter();
		await g.typeText('npm run dev');
		await g.softEnter();
		await g.typeText('npm test');
		await g.softEnter();
		await g.softEnter();
		await g.checkpoint('code', 'code');

		await g.typeText('## Links');
		await g.pressEnter();
		await g.typeText('- [Issues](https://example.com/issues)');
		await g.pressEnter();
		await g.typeText('[Changelog](https://example.com/changelog)');
		await g.pressEnter();
		await g.softEnter();
		await g.checkpoint('links', 'list');

		await g.typeText('Contributions welcome.');
	},
	landmarks: [
		'Limestone CLI',
		'local-first notes tool',
		'Quick start',
		'Clone the repo',
		'npm install',
		'Commands',
		'npm run dev',
		'npm test',
		'Links',
		'Issues',
		'Changelog',
		'Contributions welcome'
	],
	expectedMarkdown:
		'# Limestone CLI\n' +
		'A local-first notes tool. See the [docs](https://example.com/docs) to start.\n' +
		'## Quick start\n' +
		'1. Clone the repo\n' +
		'2. Install with `npm install`\n' +
		'3. Launch the dev build\n' +
		'\n' +
		'## Commands\n' +
		'```\n' +
		'npm run dev\n' +
		'npm test\n' +
		'\n' +
		'## Links\n' +
		'- [Issues](https://example.com/issues)\n' +
		'- [Changelog](https://example.com/changelog)\n' +
		'\n' +
		'Contributions welcome.\n'
};
