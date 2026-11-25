/**
 * G4.396: a `:::` container name is read in one file. The names an editor's colon types hold and
 * the names a plugin registered both answer through `core/directive/registry.ts`
 * (`resolveDirective`, `startsContainerName`), so a title-row rule never reads one set and misses the
 * other.
 */

import { collectEditorSources, LIBRARY_ROOTS } from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';

const HOME = 'src/lib/core/directive/registry.ts';

const NAMES_READ_IN_ONE_FILE: CallSiteRule = {
	id: 'G4.396 a `:::` container name is read in one file',
	population: (file) => file.relPath !== HOME,
	calls: ['.colonTypes', 'isDirectiveRegistered'],
	holds: () => false,
	allowed: {
		'src/lib/invariants/install.ts :: assertRestoredUnderGrammar':
			'a grammar view built for a restore check, handing on its editor’s names unread',
		'packages/admonitions/src/admonition-kind.ts :: registerAdmonitions':
			'the admonitions’ old registration, which its move onto a colon type deletes'
	},
	reason: 'ask `resolveDirective` or `startsContainerName`, which read every name an editor holds',
	hits: [{ relPath: 'src/lib/schema/x.ts', code: 'function f(g) {\n\treturn g.colonTypes();\n}' }],
	misses: [{ relPath: HOME, code: 'function f(g) {\n\treturn g.colonTypes();\n}' }]
};

describeCallSiteRules([NAMES_READ_IN_ONE_FILE], collectEditorSources(LIBRARY_ROOTS));
