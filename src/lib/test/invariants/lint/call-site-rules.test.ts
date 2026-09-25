/**
 * Per-call rules over the shipped source: each row names the callees whose every call must
 * satisfy a predicate on its argument text. The scan is `call-site-rule.ts`.
 */

import { callArguments, collectEditorSources } from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';
import { notUnder } from './file-rule';

// ── G4.1 createBlockListState ────────────────────────────────────────────────

/** A function by shape (an inline closure, a getter-property object) or a reference under the
 *  `getX` naming convention, which keeps value-vs-thunk decidable from shape alone. */
function isFunctionArgument(arg: string): boolean {
	if (arg.includes('=>') || /\bget\b/.test(arg) || arg.startsWith('{')) return true;
	return /(?:^|\.)get[A-Z]\w*$/.test(arg);
}

// ── The rules ────────────────────────────────────────────────────────────────

const RULES: CallSiteRule[] = [
	{
		id: 'G4.1 every createBlockListState call passes a function producing the node',
		calls: ['createBlockListState'],
		holds: (args) => {
			const first = callArguments(args)[0];
			return first === '' || isFunctionArgument(first);
		},
		reason:
			'a by-value node snapshots at factory-call time and misses undo’s deep-clone reassignment (editor.md § Reactive state plumbing)',
		hits: ['const s = createBlockListState(node);', 'createBlockListState(deps.node)'],
		misses: [
			'createBlockListState(() => node)\ncreateBlockListState({ get node() { return n; } })',
			'createBlockListState(deps.getNode)\ncreateBlockListState(getNode)',
			"import { createBlockListState } from './x';\n" +
				'export function createBlockListState(getNode: () => CstNode) {}',
			'// createBlockListState(node) would be wrong\nconst x = 1;'
		]
	},
	{
		id: 'G4.27 every parse() call outside the parser declares its scope',
		// The consumer example writes the documented default (whole-document parses); the rule is
		// about internal reparse sites, so it binds the library and the plugin-route author stand-in.
		population: notUnder('examples/consumer/src/', 'src/lib/core/parser.ts', 'src/lib/testing/'),
		calls: ['parse'],
		holds: (args) => args.includes('scope:'),
		reason:
			"every parse() call outside core/parser.ts passes an explicit scope: { scope: 'fragment' } for one block's bytes, { scope: 'document' } for whole source; silence reads as document (#52)",
		hits: ['const d = parse(raw);', "parse(')');\nparse(x, { scope: 'fragment' });"],
		misses: [
			"const d = parse(raw, { scope: 'fragment' });",
			"parse(text, { grammar, scope: 'document' })",
			"parse(strip(a, /)/), { scope: 'fragment' })",
			"parse(strip(a, (b)), { scope: 'fragment' })",
			'parse(unclosed(")"), { scope: \'fragment\' })',
			'parseInline(raw); JSON.parse(raw); doc.parse(raw); reparse(raw);',
			'export function parse(source: string): Document {'
		]
	}
];

describeCallSiteRules(RULES, collectEditorSources());
