/**
 * Per-call rules over the shipped source: each row names the callees whose every call must
 * satisfy a predicate on its argument text, most often that a required key or a trailing
 * argument was threaded rather than answered `undefined`. The scan is `call-site-rule.ts`.
 */

import { callArguments, collectEditorSources, lastArgument } from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';
import { except, notUnder } from './file-rule';

/** The published container-conformance kit has no registry view to source a grammar or a mode from. */
const CONFORMANCE_KIT = 'src/lib/testing/container-conformance.ts';

// ── G4.1 createBlockListState ────────────────────────────────────────────────

/** A function by shape (an inline closure, a getter-property object) or a reference under the
 *  `getX` naming convention, which keeps value-vs-thunk decidable from shape alone. */
function isFunctionArgument(arg: string): boolean {
	if (arg.includes('=>') || /\bget\b/.test(arg) || arg.startsWith('{')) return true;
	return /(?:^|\.)get[A-Z]\w*$/.test(arg);
}

// ── The live-mode thread ─────────────────────────────────────────────────────

/** Byte-moving sinks and the argument position (0-based) of their mode, by the names their
 *  callers import them under; the resolver follows the mode, and the grammar may follow both. */
const MODE_POSITION: Record<string, number> = {
	splitNode: 4,
	performSplit: 4,
	mergeWithNext: 2,
	performMergeNext: 2,
	mergeIntoPrevDeepLeaf: 3,
	rangeDelete: 5
};
const MODE_TRAILING_CALLS = Object.keys(MODE_POSITION);

/** Bundle factories whose deps object carries the mode and the resolver down to those sinks. */
const MODE_BEARING_FACTORIES = ['createStandardNestedActions', 'createListContext'];

/** Both axes ride the same crossings: a rewrite told the mode but not the resolver parses a
 *  reference form as brackets and declines, which is a marker leak wearing a decline's clothes. */
const THREADED_AXES = ['getPresentationMode', 'linkRef'];

/** Only the mode's `undefined` is a skipped thread, since a harness with no definitions has no
 *  resolver to give. */
const modeArgument = (args: string, callee: string): string =>
	callArguments(args)[MODE_POSITION[callee]] ?? '';

const threadsAxis = (args: string, axis: string): boolean =>
	new RegExp(`\\b${axis}\\s*[,:}]`).test(args) &&
	!new RegExp(`\\b${axis}\\s*:\\s*undefined\\b`).test(args);

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
		id: 'every container composing a nested-actions bundle threads the instance grammar',
		population: except(CONFORMANCE_KIT),
		calls: ['createStandardNestedActions'],
		holds: (args) => /\bgrammar\s*:/.test(args),
		reason:
			'a container reparsing child content without the instance grammar reads a disabled kind’s syntax',
		// Four built-in containers wire it directly, plus the plugin container factory.
		atLeastCallers: 5,
		hits: ['const b = createStandardNestedActions(state, { scope, stickyColumn, parent });'],
		misses: [
			'createStandardNestedActions(state, { scope, grammar: registryView.grammar, parent }, ovr(x))',
			'export function createStandardNestedActions(state, deps) {}\n' +
				'// createStandardNestedActions(state, { no grammar }) would be wrong'
		]
	},
	{
		id: 'every ancestry rebuild and leaf byte write resolves through the instance grammar',
		population: except(CONFORMANCE_KIT),
		calls: ['rebuildUnsharedChain', 'rebuildUnsharedAncestry', 'writeOwnRaw'],
		holds: (args) => lastArgument(args) !== 'undefined',
		reason:
			'the grammar parameter is required-nullable, so the type stops an omission but not a caller answering undefined because threading was inconvenient',
		// Routine typing, the commit sequence, the metadata refresh, paste, cross-block
		// type-replace and the four range-delete modules.
		atLeastCallers: 8,
		hits: [
			'rebuildUnsharedChain(doc, chain, sharing, undefined);',
			'out.push(...rebuildUnsharedChain(doc, chain, sharing, folds, undefined));'
		],
		misses: [
			'rebuildUnsharedChain(doc, chain, sharing, ctx.grammar);\n' +
				'rebuildUnsharedAncestry(doc, path, sharing, viewOf(deps, undefined));',
			'export function rebuildUnsharedChain(root, chain, sharing, grammar) {}\n' +
				'// rebuildUnsharedAncestry(doc, path, sharing, undefined) would be wrong'
		]
	},
	{
		id: 'every paste route threads the instance grammar',
		calls: ['pasteDispatch', 'replaceBlockAtParent'],
		// Both spellings an argument object has: an explicit `grammar:` and the shorthand.
		holds: (args) => /\bgrammar\s*[:,}]/.test(args),
		// The type rejects an omitted or undefined grammar; the scan asks each route to name it
		// rather than spread in a context the reader cannot see.
		reason:
			'pasted bytes, or the bodyWrite reparse of them, read an unlisted plugin’s syntax without the instance grammar (#267)',
		// Four clipboard routes and three splice sites.
		atLeastCallers: 7,
		hits: [
			'await pasteDispatch({ pastedText, targetPath }, { doc, blockEdit, controller });',
			'await replaceBlockAtParent({ doc, blockPath, replacement, controller });',
			'pasteDispatch(input, { ...ctx, seam });'
		],
		misses: [
			'pasteDispatch(input, { doc, blockEdit, controller, grammar })',
			'replaceBlockAtParent({ doc, controller, grammar: input.grammar })',
			'export async function pasteDispatch(input, ctx) {}\n' +
				'export async function replaceBlockAtParent(args) {}\n' +
				'// pasteDispatch(input, { no grammar }) would be wrong'
		]
	},
	{
		id: 'every byte-moving sink is told which presentation mode the bytes move in',
		population: except(CONFORMANCE_KIT),
		calls: MODE_TRAILING_CALLS,
		holds: (args, callee) => modeArgument(args, callee) !== 'undefined',
		reason:
			'split rebalancing and join cleanup run in live mode alone; a caller answering undefined ships byte-literal edits with delimiters on screen',
		// The shared block-edit core, the list mid-item split, the cross-block delete, node-ops.
		atLeastCallers: 4,
		hits: [
			'splitNode(parent, i, offset, sharing, undefined, linkRef, grammar);',
			'mergeWithNext(parent, i, undefined, ref, grammar);'
		],
		misses: [
			'splitNode(parent, i, offset, sharing, mode, undefined, grammar);\n' +
				'performSplit(p, i, o, s, deps.getPresentationMode?.(), undefined);\n' +
				'mergeWithNext(parent, i, mode, undefined, undefined);\n' +
				'rangeDelete(doc, s, e, sharing, grammar, ctx.getPresentationMode?.(), undefined);',
			'export function splitNode(parent, blockIndex, offset, sharing, presentationMode) {}\n' +
				'// performSplit(p, i, o, s, undefined, undefined) would be wrong'
		]
	},
	{
		id: 'every mode-bearing bundle threads a real getter on both axes',
		population: except(CONFORMANCE_KIT),
		calls: MODE_BEARING_FACTORIES,
		holds: (args) => THREADED_AXES.every((axis) => threadsAxis(args, axis)),
		reason:
			'a bundle that omits getPresentationMode or linkRef, or answers either with undefined, hands its sinks a mode-less edit',
		// Four built-in containers, the plugin container factory, the list context.
		atLeastCallers: 5,
		hits: [
			'createStandardNestedActions(state, { scope, stickyColumn, parent });',
			'createListContext({ scope, controller, getPresentationMode: undefined, linkRef });'
		],
		misses: [
			'createStandardNestedActions(state, { scope, getPresentationMode, linkRef, parent });\n' +
				'createListContext({ scope, getPresentationMode: policies.presentationMode, linkRef });'
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
