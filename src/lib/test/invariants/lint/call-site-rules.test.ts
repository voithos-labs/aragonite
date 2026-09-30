/**
 * Per-call rules over the shipped source: each row names the callees whose every call must
 * satisfy a predicate on its argument text. The scan is `call-site-rule.ts`.
 */

import { callArguments, collectEditorSources } from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';
import { notUnder, type Probe } from './file-rule';

// ── G4.1 createBlockListState ────────────────────────────────────────────────

/** A function by shape (an inline closure, a getter-property object) or a reference under the
 *  `getX` naming convention, which keeps value-vs-thunk decidable from shape alone. */
function isFunctionArgument(arg: string): boolean {
	if (arg.includes('=>') || /\bget\b/.test(arg) || arg.startsWith('{')) return true;
	return /(?:^|\.)get[A-Z]\w*$/.test(arg);
}

// ── G4.100 a block's own line ending ─────────────────────────────────────────

const ROGUE_BLOCK = 'src/lib/components/blocks/x/rogue.ts';
const at = (relPath: string, code: string): Probe => ({ relPath, code });

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
		// The consumer example writes the documented default (a whole-document parse); the rule
		// binds the library's own reparse sites and the reference plugins under the routes.
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
	},
	{
		id: 'G4.100 a block’s own trailing line ending is added only by the surface write',
		population: (file) =>
			file.relPath.startsWith('src/lib/components/blocks/') &&
			file.relPath !== 'src/lib/components/blocks/surface-write.ts',
		calls: ['trailingLineEnding', 'ownTrailingLineEnding'],
		holds: () => false,
		allowed: {
			'src/lib/components/blocks/editable-surface.ts :: lineEnding':
				'the ending a typed line break takes, the one place new text picks it: its own, else the document’s',
			'src/lib/components/blocks/text/text-keydown.ts :: insertHardBreak':
				'a hard break at the content’s end reuses the block’s trailing ending as its own line’s, until the pending break takes that branch',
			'src/lib/components/blocks/code/code-paste-surface.ts :: onInlinePaste':
				'a paste’s own write, which moves onto the surface write with the other clipboard edits',
			'src/lib/components/blocks/code/code-context-actions.ts :: run':
				'the dissolve action hands `replaceRaw` new text, whose ending is the document’s',
			'src/lib/components/blocks/code/code-fence-exit.ts :: computeFenceExit':
				'reads the body’s last line ending to put the closer after it, writing no block’s trailing ending',
			'src/lib/components/blocks/code/code-renderer.ts :: fenceBodyAsDrawn':
				'a render read of the body’s last line ending'
		},
		reason:
			'a write to a block’s own text goes through `surface-write.ts` (`writeText`, or `withOwnEnding` for a route not on it yet), which keeps the block’s own ending: a last line saved without one keeps none',
		hits: [
			at(ROGUE_BLOCK, 'const raw = text + trailingLineEnding(node.raw, documentLineEnding(doc));'),
			at(ROGUE_BLOCK, 'const raw = text + ownTrailingLineEnding(node.raw);')
		],
		misses: [
			at(ROGUE_BLOCK, 'const raw = withOwnEnding(node, text);'),
			at(ROGUE_BLOCK, 'const display = trimTrailingLineEnding(node.raw);'),
			at(ROGUE_BLOCK, '// text + trailingLineEnding(node.raw) was the old append'),
			at('src/lib/tree-operations/rogue.ts', 'const raw = text + ownTrailingLineEnding(node.raw);')
		]
	}
];

describeCallSiteRules(RULES, collectEditorSources());
