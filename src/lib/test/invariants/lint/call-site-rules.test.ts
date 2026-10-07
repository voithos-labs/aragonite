/**
 * Per-call rules over the shipped source: each row names the callees whose every call must
 * satisfy a predicate on its argument text. The scan is `call-site-rule.ts`.
 */

import { callArguments, collectEditorSources } from './scan-source';
import { describeCallSiteRules, type CallSiteRule } from './call-site-rule';
import { notUnder, under, type Probe } from './file-rule';
import { SOURCE, SOURCE_DIR } from './source-paths';

// ── G4.1 createBlockListState ────────────────────────────────────────────────

/** A function by shape (an inline closure, a getter-property object) or a reference under the
 *  `getX` naming convention, which keeps value-vs-thunk decidable from shape alone. */
function isFunctionArgument(arg: string): boolean {
	if (arg.includes('=>') || /\bget\b/.test(arg) || arg.startsWith('{')) return true;
	return /(?:^|\.)get[A-Z]\w*$/.test(arg);
}

// ── G4.100 a block's own line ending ─────────────────────────────────────────

const ROGUE_BLOCK = `${SOURCE_DIR.blocks}x/rogue.ts`;
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
		population: notUnder(SOURCE_DIR.consumerExample, SOURCE.parser, SOURCE_DIR.testing),
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
			file.relPath.startsWith(SOURCE_DIR.blocks) && file.relPath !== SOURCE.surfaceWrite,
		calls: ['trailingLineEnding', 'ownTrailingLineEnding'],
		holds: () => false,
		allowed: {
			'src/lib/components/blocks/editable-surface.ts :: lineEnding':
				'the getter for the ending a typed line break takes: its own, else the document’s',
			'src/lib/components/blocks/text/text-keydown.ts :: insertHardBreak':
				'a hard break inside the text, a command that keeps the block’s own ending until it moves onto the surface write with the other commands',
			'src/lib/components/blocks/code/code-paste-surface.ts :: onInlinePaste':
				'a paste’s own write, which moves onto the surface write with the other clipboard edits',
			'src/lib/components/blocks/code/code-context-actions.ts :: run':
				'a second new-text ending, beside the typed line break’s: the dissolve action’s prose replaces the fence, so it takes the document’s ending (the two share one home under #648)',
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
	},
	{
		id: 'G4.111 an editable element writes its own text through the surface write',
		// A bundled or reference plugin's block component is an editable element too.
		population: (file) =>
			under(
				SOURCE_DIR.components,
				SOURCE_DIR.selection,
				SOURCE_DIR.plugins,
				SOURCE_DIR.referencePlugins
			)(file) && file.relPath !== SOURCE.surfaceWrite,
		calls: ['.updateBlockContent'],
		holds: () => false,
		allowed: {
			'src/lib/components/blocks/text/TextEditableBlock.svelte :: toggleFormat':
				'a command, which moves once commands take their own undo entry through the surface write',
			'src/lib/components/blocks/text/TextEditableBlock.svelte :: perform':
				'the demote and heading cycle commands, moving with the other commands',
			'src/lib/components/blocks/text/TextEditableBlock.svelte :: writeHardBreak':
				'Shift+Enter inside the text, a command moving with the other commands (at the end it writes nothing until the next insertion)',
			'src/lib/components/blocks/table/TableCellBlock.svelte :: toggleFormat':
				'a command, moving with the other commands',
			'src/lib/components/blocks/table/TableCellBlock.svelte :: deleteCellRange':
				'the cell menu’s cut, moving with the other clipboard edits',
			'src/lib/components/blocks/text/text-clipboard.ts :: removeWidget':
				'a cut of a selected widget, moving with the other clipboard edits',
			'src/lib/components/blocks/text/text-clipboard.ts :: removeRange':
				'a cut in a text block, moving with the other clipboard edits',
			'src/lib/components/blocks/text/widget-interaction.ts :: commitReveal':
				'an inline widget’s shown source, moving with the fold that closes it'
		},
		reason:
			'`surface-write.ts :: writeText` records the caret from before the gesture as undo’s, keeps the block’s line ending and puts the caret back; a direct write picks its own undo caret',
		hits: [
			at(ROGUE_BLOCK, 'void blockEdit.updateBlockContent(index, raw, mode, after, after);'),
			at(ROGUE_BLOCK, 'void wiring.deps.blockEdit.updateBlockContent(index, raw, mode, 0, 0);'),
			at(
				`${SOURCE_DIR.plugins}x/XBlock.svelte`,
				'void blockEdit.updateBlockContent(index, raw, mode, 0, 0);'
			),
			at(
				`${SOURCE_DIR.referencePlugins}x/XBlock.svelte`,
				'void blockEdit.updateBlockContent(index, raw, mode, 0, 0);'
			)
		],
		misses: [
			at(
				ROGUE_BLOCK,
				'void editableSurface.writeText({ text, caretAfter, intent, mode, source });'
			),
			at('src/lib/editor-actions/rogue.ts', 'blockEdit.updateBlockContent(index, raw, mode, 0, 0);')
		]
	},
	{
		id: 'G4.115 a clipboard payload is written only by a copy',
		calls: ['.setData'],
		holds: () => false,
		allowed: {
			'src/lib/components/blocks/clipboard-step.ts :: writeShownSelection':
				'the copy of what the user sees: reading mode, a copy no `ClipboardArm` takes, and the code block',
			'src/lib/components/blocks/text/text-clipboard.ts :: copyWidget':
				'the text block’s copy of a selected widget',
			'src/lib/components/blocks/text/text-clipboard.ts :: copyRange':
				'the text block’s copy of its own range',
			'src/lib/components/blocks/table/TableCellBlock.svelte :: copyCellRange':
				'the cell’s copy of its own range',
			'src/lib/components/blocks/editable-leaf.ts :: copyRange':
				'a plugin leaf’s copy of its own range',
			'src/lib/selection/cross-block/clipboard.ts :: copyCrossBlock':
				'the copy of a range across blocks, a cell rectangle included',
			'src/lib/components/menu/clipboard-actions.ts :: pasteTextInto':
				'the data a menu’s paste event carries in, not a copy’s payload'
		},
		reason:
			'a payload is written by a `ClipboardArm`’s `copy`, which a cut reuses before anything awaits; written anywhere else, a cut’s payload can differ from the copy’s, or land after a scripted cut’s data has closed',
		hits: [
			at(ROGUE_BLOCK, "e.clipboardData?.setData('text/plain', text);"),
			at('src/lib/selection/rogue.ts', "event.clipboardData!.setData('text/html', html);"),
			at('src/lib/editor-actions/rogue.ts', "e.clipboardData?.setData('text/plain', raw);")
		],
		misses: [
			at(ROGUE_BLOCK, "const text = e.clipboardData?.getData('text/plain');"),
			at(ROGUE_BLOCK, "// e.clipboardData?.setData('text/plain', text) was the old cut")
		]
	},
	{
		id: 'G4.100 the typed line break’s ending is read only where a line break is typed',
		population: (file) => file.relPath.startsWith(SOURCE_DIR.blocks),
		calls: ['editableSurface.lineEnding', 'deps.lineEnding'],
		holds: () => false,
		allowed: {
			'src/lib/components/blocks/code/CodeBlock.svelte :: writeLineBreak':
				'Enter or a soft break (Shift+Enter, or a line break with no key) types a new line, and an electric indent two',
			'src/lib/components/blocks/code/CodeBlock.svelte :: rangedEditInsertion':
				'the line break a key types over a selection',
			'src/lib/components/blocks/code/CodeBlock.svelte :: bareFenceCompletion':
				'a bare fence gets its body and closing lines, on Enter or as the caret arrives',
			'src/lib/components/blocks/editable-leaf.ts :: reshapeSource':
				'a plugin source shown or edited gets the lines its kind adds, a bare one a body line',
			'src/lib/components/blocks/code/CodeBlock.svelte :: closeUnclosedFenceAndDescend':
				'Enter past an unclosed fence adds the closing line and the paragraph below',
			'src/lib/components/blocks/text/TextEditableBlock.svelte :: writeHardBreak':
				'Shift+Enter types a new line',
			'src/lib/components/blocks/editable-leaf.ts :: breakLine':
				'Enter in a multi-line plugin source types a new line',
			'src/lib/components/blocks/editable-leaf.ts :: onBeforeInput':
				'a line break with no key in a painted plugin source types a new line',
			'src/lib/components/blocks/text/TextEditableBlock.svelte :: handleDelimiterAutoPair':
				'asks whether a completion is planned, and writes nothing'
		},
		reason:
			'the getter gives a new line an ending, the document’s where the block has none; a write to the block’s own text keeps the ending it has (`withOwnEnding`), so the getter inside one adds a break a last line saved without one never had',
		hits: [
			at(ROGUE_BLOCK, 'const raw = display + editableSurface.lineEnding();'),
			at(ROGUE_BLOCK, 'openLine(text, deps.lineEnding());')
		],
		misses: [
			at(ROGUE_BLOCK, 'const ending = parent.containerEdit.lineEnding();'),
			at(ROGUE_BLOCK, 'const raw = withOwnEnding(node, display);'),
			at('src/lib/editor-actions/rogue.ts', 'const raw = display + editableSurface.lineEnding();')
		]
	}
];

describeCallSiteRules(RULES, collectEditorSources());
