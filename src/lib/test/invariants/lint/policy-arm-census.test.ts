/**
 * Every live gesture rule is a row in the inline-construct policy table, or a branch that names a
 * construct itself and says why (live-mode.md § 3). This list holds both sets: the branches that
 * read rows, and the ones still answering by hand, each with a decided fate. It also fixes the
 * boundary between the two tables: rows answer for hidden delimiter runs, the inline widget
 * registry answers for non-editable widgets, and a file asking both says why.
 */

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { EDITOR_SRC, collectEditorSources, stripComments, type SourceFile } from './scan-source';

/**
 * Where a live gesture can live: the block components and the caret, selection, tree and view
 * layers they dispatch into. `core/` and `schema/` sit outside on purpose, because the parser
 * names every kind to build the tree and the table's own registration names every kind to declare
 * its rows.
 */
const GESTURE_ROOTS = [
	'components',
	'cursor',
	'selection',
	'tree-operations',
	'decorations',
	'search',
	'ambient'
];

const POLICY_TABLE = 'src/lib/schema/inline-construct-policy.ts';
const WIDGET_REGISTRY = 'src/lib/core/inline/inline-widgets.ts';

// ── Matchers ─────────────────────────────────────────────────────────────────

/** Every function that reads the policy table, the table's own module excluded. */
const POLICY_READ =
	/(?<![\w.])(getInlineConstructPolicy|getInlineMarkPolicy|inlineMarkForCommand|isCardEditableInlineKind|isRevealableInlineKind|listInlineConstructPolicies|listInlineMarks|getLiveSplitRebalancer|getLiveJoinSeamCleaner)\s*\(/;

const readsPolicyTable = (file: SourceFile): boolean =>
	file.relPath !== POLICY_TABLE && POLICY_READ.test(stripComments(file.text));

/** The widget registry's functions: the other table, whose subject is the non-editable widget. */
const WIDGET_READ =
	/(?<![\w.])(getInlineWidgetEditing|isInlineWidget|isInlineWidgetKind|isCharacterLikeWidget|widgetSourceRange|augmentInlineWidgetKind)\s*\(/;

const readsWidgetRegistry = (file: SourceFile): boolean =>
	file.relPath !== WIDGET_REGISTRY && WIDGET_READ.test(stripComments(file.text));

/** The kinds the table has rows for. A quoted literal is the tripwire: naming one in a gesture
 *  branch answers a per-construct question the row exists to answer. */
const ROWED_KINDS = [
	'emphasis',
	'strong',
	'strikethrough',
	'inlineCode',
	'link',
	'image',
	'autolink',
	'escape',
	'hardLineBreak'
];

const KIND_LITERAL = new RegExp(`['"](${ROWED_KINDS.join('|')})['"]`);

const namesConstructKind = (file: SourceFile): boolean =>
	KIND_LITERAL.test(stripComments(file.text));

// ── The branches that read rows ──────────────────────────────────────────────

/** Every reader of the table, and which column it is there for. Set equality both ways, so a new
 *  reader is a decision rather than a silent eighth opinion on a row's meaning. */
const POLICY_ARMS: Record<string, string> = {
	'src/lib/components/blocks/text/construct-edge-delete.ts':
		'the destructive arm: autoUnwrapOnEmpty',
	'src/lib/components/blocks/text/construct-reveal.ts': "preview-inline's reveal chain: revealable",
	'src/lib/components/blocks/text/edge-seat.ts': 'the typing seat: edgeAffinity',
	'src/lib/components/blocks/text/link-at-point.ts': 'the card entry: cardEditable',
	'src/lib/components/blocks/text/live-join-seam.ts':
		'the join cleaner: splitBehavior, and autoUnwrapOnEmpty for a construct the cut emptied',
	'src/lib/components/blocks/text/live-split-rebalance.ts': 'the split rebalancer: splitBehavior',
	'src/lib/components/blocks/text/pending-mark-insert.ts':
		'the pending-mark resolver: edgeAffinity and the mark nesting order',
	'src/lib/components/blocks/table/TableCellBlock.svelte':
		'the cell surface: which mark a format command toggles',
	'src/lib/core/inline/format-toggle.ts': 'the toggle seam: the mark vocabulary',
	'src/lib/components/blocks/text/TextEditableBlock.svelte':
		'the prose surface: the same command lookup',
	'src/lib/schema/registration-checks.ts': 'the registration-time coherence check over every row',
	'src/lib/selection/cross-block/format-toggle.ts':
		'the cross-block arm: which mark a format command toggles',
	'src/lib/tree-operations/node-ops.ts': 'the one reader of both registered rewrite slots'
};

/** A file asking both tables, and why it needs both answers. Only a whole block legitimately
 *  does: it hosts every inline kind at once, so it meets the delimiter-run question and the
 *  widget question on the same keystroke. Anything below a block asking both is the boundary
 *  blurring, which is what this list is here to make visible. */
const BOTH_TABLE_READERS: Record<string, string> = {
	'src/lib/components/blocks/text/TextEditableBlock.svelte':
		'the prose surface: which mark a format command toggles, and whether a node is an island',
	'src/lib/components/blocks/table/TableCellBlock.svelte': 'the same pair on the cell surface'
};

// ── The branches that answer by hand ─────────────────────────────────────────

interface HandWrittenArm {
	path: string;
	/** How the scan sees it: a kind literal it can find, or a shape only a reader can. */
	detection: 'kind-literal' | 'declared';
	/** `backlog` is undecided, and forbidden. `deferred` names what blocks the row. `outside` is a
	 *  decision: the question is not the table's to answer. */
	fate: 'backlog' | 'deferred' | 'outside';
	reason: string;
}

const HAND_WRITTEN_ARMS: readonly HandWrittenArm[] = [
	{
		path: 'src/lib/components/menu/default-context-actions.ts',
		detection: 'kind-literal',
		fate: 'outside',
		reason:
			'a label map, not an `arms` entry: it names block kinds only to name them in a menu row ("Remove code block"); no gesture reads it and no construct policy hangs on it'
	},
	{
		path: 'src/lib/components/menu/SelectionToolbar.svelte',
		detection: 'kind-literal',
		fate: 'outside',
		reason:
			'icon names on the mark buttons ("link"), not construct kinds: every button runs a command id and the command registry decides admissibility'
	},
	{
		path: 'src/lib/components/blocks/text/construct-edge-delete.ts',
		detection: 'declared',
		fate: 'outside',
		reason:
			'which constructs it takes whole is a per-node fact: `[](u)` is a link with no content range, `![a](u)` an atomic widget with one, so a kind column would swap both answers'
	},
	{
		path: 'src/lib/components/blocks/text/live-join-seam.ts',
		detection: 'declared',
		fate: 'outside',
		reason: 'the same per-node arity, in classifyConstructs, on the same two shapes'
	},
	{
		path: 'src/lib/components/blocks/text/edge-policy-dispatch.ts',
		detection: 'declared',
		fate: 'outside',
		reason:
			'a declared `arms` list, and never rows: this is a total order over gesture families, where a row answers a per-construct question, and the reading-mode cut is an entry in that order for the same reason'
	},
	{
		path: 'src/lib/components/blocks/text/link-source-bytes.ts',
		detection: 'kind-literal',
		fate: 'deferred',
		reason:
			'the link serializer wants a rewriteBytes row slot; blocked on making LinkFields kind-opaque first'
	},
	{
		path: POLICY_TABLE,
		detection: 'declared',
		fate: 'deferred',
		reason:
			'the no-residue rule is restated at four `arms` entries; single-sourcing it into the table folds into the slots-to-rows move'
	},
	{
		path: POLICY_TABLE,
		detection: 'declared',
		fate: 'deferred',
		reason:
			'the two rewrite slots hold one global function each rather than per-kind rows; moving them turns a register-once throw into a silent per-row degrade, so it needs the close-and-reopen producer assertion first'
	},
	{
		path: 'src/lib/components/built-in-blocks.ts',
		detection: 'kind-literal',
		fate: 'outside',
		reason:
			'the widget registry side of the two-table boundary: image as an atomic widget, not a hidden delimiter run'
	},
	{
		path: 'src/lib/components/image/image-edit-commit.ts',
		detection: 'kind-literal',
		fate: 'outside',
		reason: 'the same widget question, re-finding the widget an open editor is anchored to'
	}
];

/** Empty: every live gesture rule is a row, a decided `outside`, or a `deferred` naming its blocker. */
const backlog = HAND_WRITTEN_ARMS.filter((arm) => arm.fate === 'backlog');
const kindLiteralArms = HAND_WRITTEN_ARMS.filter((arm) => arm.detection === 'kind-literal');

// ── The census ───────────────────────────────────────────────────────────────

describe('inline-construct policy branch census', () => {
	const gestureSources = GESTURE_ROOTS.flatMap((root) =>
		collectEditorSources(path.join(EDITOR_SRC, root))
	);
	const allSources = collectEditorSources();
	const paths = (files: SourceFile[]) => files.map((file) => file.relPath).sort();
	const unique = (values: string[]) => [...new Set(values)].sort();

	it('every declared branch is on disk and reachable by the scan', () => {
		const declared = unique([
			...Object.keys(POLICY_ARMS),
			...HAND_WRITTEN_ARMS.map((arm) => arm.path)
		]);
		const onDisk = new Set(allSources.map((file) => file.relPath));
		expect(declared.filter((file) => !onDisk.has(file))).toEqual([]);
	});

	it('every reader of the policy table is declared with the column it reads', () => {
		expect(
			paths(allSources.filter(readsPolicyTable)),
			'a new file started reading the policy table: add it to POLICY_ARMS with the column it is there for'
		).toEqual(Object.keys(POLICY_ARMS).sort());
	});

	it('every gesture branch naming a construct kind is declared with its reason and fate', () => {
		expect(
			paths(gestureSources.filter(namesConstructKind)),
			'a gesture branch started naming a construct kind: give the question a row, or declare the branch in HAND_WRITTEN_ARMS with why it stays'
		).toEqual(unique(kindLiteralArms.map((arm) => arm.path)));
	});

	it('no hand-written branch is an undecided backlog entry', () => {
		expect(
			backlog,
			'a hand-written branch needs a row, a decided `outside`, or a `deferred` naming its blocker'
		).toEqual([]);
	});

	it('every declared branch carries a reason', () => {
		expect(HAND_WRITTEN_ARMS.filter((arm) => arm.reason.trim() === '')).toEqual([]);
		expect(Object.entries(POLICY_ARMS).filter(([, reason]) => reason.trim() === '')).toEqual([]);
	});

	// ── The two-table boundary ───────────────────────────────────────────────

	it('a file reading both tables is declared with why it needs both answers', () => {
		const both = allSources.filter((file) => readsPolicyTable(file) && readsWidgetRegistry(file));
		expect(
			paths(both),
			'a file started asking both tables: declare it in BOTH_TABLE_READERS with why one answer is not enough'
		).toEqual(Object.keys(BOTH_TABLE_READERS).sort());
	});

	// An empty intersection above proves the boundary only while both halves can see anything.
	it('both table matchers find readers, so the boundary is not an artifact of a dead matcher', () => {
		expect(allSources.filter(readsPolicyTable).length).toBeGreaterThan(0);
		expect(allSources.filter(readsWidgetRegistry).length).toBeGreaterThan(0);
	});

	// ── Matcher self-tests (non-vacuity) ─────────────────────────────────────

	const probe = (matcher: (file: SourceFile) => boolean, text: string) =>
		matcher({ relPath: 'src/lib/components/blocks/text/probe.ts', text, code: '' });

	it('the policy matcher sees every entry point and skips a mention in prose', () => {
		expect(probe(readsPolicyTable, 'const p = getInlineConstructPolicy(node.kind);')).toBe(true);
		expect(probe(readsPolicyTable, 'if (isRevealableInlineKind(kind)) out.push(node);')).toBe(true);
		expect(probe(readsPolicyTable, 'getLiveJoinSeamCleaner()?.(join)')).toBe(true);
		expect(probe(readsPolicyTable, '// getInlineConstructPolicy(kind) is the door')).toBe(false);
		expect(probe(readsPolicyTable, 'const x = myGetInlineConstructPolicy(kind);')).toBe(false);
	});

	it('the widget matcher sees the registry entry points and skips prose', () => {
		expect(probe(readsWidgetRegistry, 'getInlineWidgetEditing(widget.kind)?.revealSource')).toBe(
			true
		);
		expect(probe(readsWidgetRegistry, 'if (isInlineWidget(node)) return null;')).toBe(true);
		expect(probe(readsWidgetRegistry, '/* widgetSourceRange(el) answers */')).toBe(false);
	});

	it('the kind matcher sees a literal in either quote and skips a dotted command id', () => {
		expect(
			probe(namesConstructKind, "if (node.kind === 'inlineCode') return codeWrap(slice);")
		).toBe(true);
		expect(probe(namesConstructKind, 'const MARKS = ["strong", "emphasis"];')).toBe(true);
		// The nearby spellings that are not a per-construct answer: a command id, a DOM tag read,
		// and the same word in prose.
		expect(probe(namesConstructKind, "if (id === 'format.toggleStrong') return toggle();")).toBe(
			false
		);
		expect(probe(namesConstructKind, "el.querySelector('strong > em')")).toBe(false);
		expect(probe(namesConstructKind, '// a link never extends at its edges')).toBe(false);
	});

	it('an undeclared gesture branch naming a kind fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/components/blocks/text/rogue.ts',
			text: "if (node.kind === 'strikethrough') return null;",
			code: ''
		};
		expect(paths([...gestureSources, rogue].filter(namesConstructKind))).not.toEqual(
			unique(kindLiteralArms.map((arm) => arm.path))
		);
	});

	it('an undeclared policy reader fails the set equality', () => {
		const rogue: SourceFile = {
			relPath: 'src/lib/selection/rogue.ts',
			text: 'const p = getInlineConstructPolicy(kind);',
			code: ''
		};
		expect(paths([...allSources, rogue].filter(readsPolicyTable))).not.toEqual(
			Object.keys(POLICY_ARMS).sort()
		);
	});
});
