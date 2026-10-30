/**
 * Every live gesture rule is a row in the inline-construct policy table, or a branch that names a
 * construct itself and says why (live-mode.md § 3). This list holds both sets: the branches that
 * read rows, and the ones still answering by hand, each with a decided fate. It also fixes the
 * boundary between the two tables: rows answer for hidden delimiter runs, the inline widget
 * registry answers for non-editable widgets, and a file asking both says why.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, type SourceFile } from './scan-source';
import { describeManifests, under } from './file-rule';
import { SOURCE, SOURCE_DIR } from './source-paths';

/** Where a live gesture can live: the block components and the layers they dispatch into. `core/`
 *  and `schema/` sit outside, since the parser and the table's registration name every kind. */
const GESTURE_ROOTS = [
	SOURCE_DIR.components,
	SOURCE_DIR.browser,
	SOURCE_DIR.caret,
	SOURCE_DIR.windowing,
	SOURCE_DIR.selection,
	SOURCE_DIR.treeOperations,
	SOURCE_DIR.decorations,
	SOURCE_DIR.search
];

/** Gesture code under `core/`: the link card's byte writer sits beside the link grammar it inverts. */
const GESTURE_FILES: string[] = [SOURCE.linkSourceBytes];

const POLICY_TABLE = SOURCE.inlineConstructPolicy;
const WIDGET_REGISTRY = SOURCE.inlineWidgets;

// ── Matchers ─────────────────────────────────────────────────────────────────

/** Every function that reads the policy table, the table's own module excluded. */
const POLICY_READ =
	/(?<![\w.])(getInlineConstructPolicy|getInlineMarkPolicy|inlineMarkForCommand|followEditOf|isRevealableInlineKind|listInlineConstructPolicies|listInlineMarks)\s*\(/;

const readsPolicyTable = (file: SourceFile): boolean =>
	file.relPath !== POLICY_TABLE && POLICY_READ.test(file.code);

/** The widget registry's functions: the other table, whose subject is the non-editable widget. */
const WIDGET_READ =
	/(?<![\w.])(getInlineWidgetEditing|isInlineWidget|isInlineWidgetKind|isCharacterLikeWidget|widgetSourceRange|augmentInlineWidgetKind)\s*\(/;

const readsWidgetRegistry = (file: SourceFile): boolean =>
	file.relPath !== WIDGET_REGISTRY && WIDGET_READ.test(file.code);

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

// ── The branches that read rows ──────────────────────────────────────────────

/** Every reader of the table, and which column it is there for. Set equality both ways, so a new
 *  reader is a decision rather than one more silent opinion on a row's meaning. */
const POLICY_ARMS: Record<string, string> = {
	'src/lib/components/blocks/text/construct-edge-delete.ts':
		'the destructive arm: autoUnwrapOnEmpty, the mark column to say which unwrapped construct a chord can write again, and splitBehavior for a construct no part of which stands alone',
	'src/lib/components/blocks/text/construct-reveal.ts': "preview-inline's reveal chain: revealable",
	'src/lib/components/blocks/text/edge-seat.ts': 'the typing seat: edgeAffinity',
	'src/lib/caret/caret-look.ts':
		'the look: edgeAffinity, whether the next letter sits inside a box whose border has two stops',
	'src/lib/components/blocks/text/link-at-point.ts':
		'what a click follows and how Edit link edits it: followEdit',
	'src/lib/components/blocks/text/inline-commands.ts':
		'the format commands of a paragraph and a table cell: which mark a command toggles',
	'src/lib/components/blocks/text/next-byte.ts':
		'the caret look: the mark column, for which constructs a typed letter would carry',
	'src/lib/core/inline/live-edit/live-join.ts':
		'the join cleaner: autoUnwrapOnEmpty for a construct the cut emptied, and edgeAffinity for where typed text lands',
	'src/lib/core/inline/live-edit/live-split.ts':
		'the split rebalancer: splitBehavior, for a construct a cut takes whole',
	'src/lib/components/blocks/text/pending-mark-insert.ts':
		'the pending-mark resolver: the mark nesting order',
	'src/lib/components/blocks/table/TableCellBlock.svelte':
		'the cell surface: which mark a format command toggles',
	'src/lib/core/inline/format-toggle.ts': 'the toggle seam: the mark vocabulary',
	'src/lib/core/inline/live-edit/close-reopen.ts':
		'whether a cut closes and reopens a run: splitBehavior, and the marker it is written with: the mark vocabulary',
	'src/lib/components/blocks/text/TextEditableBlock.svelte':
		'the prose surface: the same command lookup',
	'src/lib/schema/registration-checks.ts': 'the registration-time coherence check over every row',
	'src/lib/selection/cross-block/format-toggle.ts':
		'the cross-block arm: which mark a format command toggles',
	'src/lib/inline-menu/inline-menu-session.ts': 'whether a trigger sits in prose: prose'
};

/** A file asking both tables, and why. Only a whole block legitimately does, hosting every inline
 *  kind at once; anything below a block asking both blurs the boundary between the tables. */
const BOTH_TABLE_READERS: Record<string, string> = {
	'src/lib/components/blocks/table/TableCellBlock.svelte':
		'the cell surface: which mark a format command toggles, and whether a node is an island',
	'src/lib/inline-menu/inline-menu-session.ts':
		'a row declares how much of a construct is prose; a widget kind with no row shows source, not prose',
	'src/lib/components/blocks/text/link-at-point.ts':
		'what a click follows and Edit link edits is a construct whose row declares followEdit or a widget whose kind claims the activation click, one answer across both tables'
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
			'the menu noun "image" for a paragraph of pictures, not the inline kind: no gesture reads it and no construct policy hangs on it'
	},
	{
		path: 'src/lib/components/editor-root/menus.ts',
		detection: 'kind-literal',
		fate: 'outside',
		reason:
			'the "link" icon on the Edit link row, not a construct kind: the row runs `link.openCard` and the block decides what it edits'
	},
	{
		path: 'src/lib/components/blocks/table/TableActionMenu.svelte',
		detection: 'kind-literal',
		fate: 'outside',
		reason:
			'the "link" icon on the table menu’s Edit link row, not a construct kind: the cell runs `link.openCard` and decides what it edits'
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
			'which constructs a key takes whole is a per-node fact: `[](u)` is a link with no content range, `![a](u)` an atomic widget with one, so a kind column would swap both answers; the row only says what an unmade URL falls back to'
	},
	{
		path: 'src/lib/core/inline/live-edit/live-join.ts',
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
		path: 'src/lib/core/inline/link-source-bytes.ts',
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

// ── The census ───────────────────────────────────────────────────────────────

const allSources = collectEditorSources();
const inGestureCode = (file: SourceFile): boolean =>
	under(...GESTURE_ROOTS)(file) || GESTURE_FILES.includes(file.relPath);
const gestureProbe = (code: string) => ({
	relPath: 'src/lib/components/blocks/text/probe.ts',
	code
});

describeManifests(
	[
		{
			id: 'every reader of the policy table is declared with the column it reads',
			matches: readsPolicyTable,
			declared: POLICY_ARMS,
			reason:
				'a new file started reading the policy table: add it to POLICY_ARMS with the column it is there for',
			hits: [
				'const p = getInlineConstructPolicy(node.kind);',
				'if (isRevealableInlineKind(kind)) out.push(node);',
				'for (const { kind } of listInlineMarks()) seen.add(kind);'
			],
			misses: [
				'// getInlineConstructPolicy(kind) is the door',
				'const x = myGetInlineConstructPolicy(kind);'
			]
		},
		{
			id: 'every gesture branch naming a construct kind is declared with its reason and fate',
			population: inGestureCode,
			matches: KIND_LITERAL,
			declared: Object.fromEntries(
				HAND_WRITTEN_ARMS.filter((arm) => arm.detection === 'kind-literal').map((arm) => [
					arm.path,
					arm.reason
				])
			),
			reason:
				'a gesture branch started naming a construct kind: give the question a row, or declare the branch in HAND_WRITTEN_ARMS with why it stays',
			hits: [
				gestureProbe("if (node.kind === 'inlineCode') return codeWrap(slice);"),
				gestureProbe('const MARKS = ["strong", "emphasis"];')
			],
			// The nearby spellings that are not a per-construct answer: a command id, a DOM tag read,
			// and the same word in prose.
			misses: [
				gestureProbe("if (id === 'format.toggleStrong') return toggle();"),
				gestureProbe("el.querySelector('strong > em')"),
				gestureProbe('// a link never extends at its edges')
			]
		},
		// Only a whole block legitimately asks both tables, hosting every inline kind at once; a
		// declared entry matching both also proves neither matcher is dead.
		{
			id: 'a file reading both tables is declared with why it needs both answers',
			matches: (file) => readsPolicyTable(file) && readsWidgetRegistry(file),
			declared: BOTH_TABLE_READERS,
			reason:
				'a file started asking both tables: declare it in BOTH_TABLE_READERS with why one answer is not enough',
			hits: [
				'getInlineWidgetEditing(widget.kind)?.revealSource;\nconst p = getInlineConstructPolicy(kind);',
				'if (isInlineWidget(node)) return null;\nif (isRevealableInlineKind(kind)) return kind;'
			],
			misses: [
				'getInlineWidgetEditing(widget.kind)?.revealSource;',
				'/* widgetSourceRange(el) answers */\nconst p = getInlineConstructPolicy(kind);'
			]
		}
	],
	allSources
);

describe('inline-construct policy hand-written branches', () => {
	it('every branch declared by reading is on disk', () => {
		const onDisk = new Set(allSources.map((file) => file.relPath));
		const declared = HAND_WRITTEN_ARMS.filter((arm) => arm.detection === 'declared');
		expect(declared.map((arm) => arm.path).filter((file) => !onDisk.has(file))).toEqual([]);
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
});
