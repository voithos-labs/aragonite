// What the bounded-exhaustive suites enumerate: every string up to a length over the characters
// that change how Markdown reads (block and inline markers, a letter, a space, a newline). The
// lengths `npm test` runs keep each suite to seconds; `npm run test:exhaustive` raises them.

import type { EditorPlugin } from '#lib/plugin.js';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { footnotesPlugin } from '#lib/plugins/footnotes/index.js';
import { latexPlugin } from '#lib/plugins/latex/index.js';

export const EXHAUSTIVE_ALPHABET = [
	'#',
	'>',
	'-',
	'*',
	'_',
	'[',
	']',
	'|',
	'`',
	'$',
	':',
	'!',
	'a',
	' ',
	'\n'
] as const;

const FULL = process.env.EXHAUSTIVE_FULL === '1';

/** The plugin syntax gets the longer full run, since it reads every built-in construct too. */
export const ROUND_TRIP_LENGTH = FULL ? 7 : 5;
export const BUILT_IN_ROUND_TRIP_LENGTH = FULL ? 6 : 5;
export const INLINE_LENGTH = FULL ? 6 : 5;
/** A release raises it to 4 (about 14 minutes); past that the count outgrows any run. */
export const EDIT_LENGTH = Number(process.env.EXHAUSTIVE_EDIT_LENGTH ?? (FULL ? 3 : 2));

/** The bundled plugins whose syntax these characters spell: `$` math, `:::` and `> [!` boxes,
 *  `[^` footnotes. Installed in each test body, since the platform resets between tests. */
export const ALPHABET_PLUGINS = (): EditorPlugin[] => [
	admonitionsPlugin(),
	footnotesPlugin(),
	latexPlugin({ renderer: () => ({ dom: document.createElement('span') }) })
];

/** Failures past this many are counted, not listed. */
export const LISTED_FAILURES = Number(process.env.EXHAUSTIVE_LISTED ?? 20);
