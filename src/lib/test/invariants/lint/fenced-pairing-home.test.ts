/**
 * G4.397: a fenced shape's lines are paired in one file. A fixed fence and a fenced container find
 * their closing line in `schema/fence-shape.ts`, which skips a code fence in a body there; no other
 * file outside the code fence's own parser looks for a code fence's closer to pair lines past it.
 */

import { collectEditorSources, LIBRARY_ROOTS } from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';

const HOME = 'src/lib/schema/fence-shape.ts';
const CODE_FENCE = 'src/lib/core/parsers/';

const PAIRED_IN_ONE_FILE: CallSiteRule = {
	id: 'G4.397 a fenced shape is paired in one file',
	population: (file) => file.relPath !== HOME && !file.relPath.startsWith(CODE_FENCE),
	calls: ['findFenceCloser'],
	holds: () => false,
	// Every fenced shape reads through the home now, so the rule waits for the next caller.
	atLeastCallers: 0,
	reason:
		'pair a fenced shape through `fencedLines` or `fencedBlock`, whose reading skips code fences',
	hits: [
		{ relPath: 'packages/x/src/x.ts', code: 'function f(l) {\n\tfindFenceCloser(l, 1, 2, f);\n}' }
	],
	misses: [{ relPath: HOME, code: 'function f(l) {\n\tfindFenceCloser(l, 1, 2, f);\n}' }]
};

describeCallSiteRules([PAIRED_IN_ONE_FILE], collectEditorSources(LIBRARY_ROOTS));
