// G4.303: each block kind's cut, copy and paste facts agree with what its registration and its own
// parse already say, with every bundled plugin installed. Only a fact nothing else states is
// written out below, and each field is its own row, whatever source the facts later read from.
import { beforeEach, describe, expect, it } from 'vitest';
import type { AnyBlockKind, CstNode } from '#lib/core/nodes.js';
import { parse } from '#lib/core/parser.js';
import { isDirectiveContainerKind } from '#lib/core/directive/registry.js';
import {
	blockViewFor,
	getAllRegisteredKinds,
	mustHoldChild,
	tryGetBlockKindDescriptor,
	type MergeRole
} from '#lib/schema/block-kind-descriptor.js';
import { blockViewForm, domViewSpec } from '#lib/schema/block-view.js';
import { everyInstalledPlugin } from '#lib/schema/plugin-activation.js';
import { installPlugins, type EditorPlugin } from '#lib/schema/plugin-install.js';
import { reservedChromeKindOf } from '#lib/schema/reserved-chrome.js';
import { blockFacts, hasTextPosition, type BlockFacts } from '#lib/schema/block-facts.js';
import { bundledPluginDirs } from '../invariants/lint/scan-source';
import { admonitionsPlugin } from '#packages/admonitions/src/index.js';
import { detailsPlugin } from '#packages/details/src/index.js';
import { emojiPlugin } from '#packages/emoji/src/index.js';
import { footnotesPlugin } from '#packages/footnotes/src/index.js';
import { highlightOccurrencesPlugin } from '#packages/highlight-occurrences/src/index.js';
import { latexPlugin } from '#packages/latex/src/index.js';
import { mermaidPlugin } from '#packages/mermaid/src/index.js';
import { parrotPlugin } from '#packages/parrot/src/index.js';
import { slashCommandsPlugin } from '#packages/slash-commands/src/index.js';
import { tocPlugin } from '#packages/toc/src/index.js';

/** Every bundled plugin by its directory, so a plugin added on disk fails until it is listed. */
const BUNDLED: Record<string, () => EditorPlugin> = {
	admonitions: admonitionsPlugin,
	details: detailsPlugin,
	emoji: emojiPlugin,
	footnotes: footnotesPlugin,
	'highlight-occurrences': () => highlightOccurrencesPlugin(),
	latex: () => latexPlugin(),
	mermaid: mermaidPlugin,
	parrot: parrotPlugin,
	'slash-commands': slashCommandsPlugin,
	toc: tocPlugin
};
// One instance each: installing a second object under a plugin's name warns.
const PLUGINS = Object.values(BUNDLED).map((plugin) => plugin());

beforeEach(() => installPlugins(PLUGINS));

// ── What nothing else states ─────────────────────────────────────────────────

const MARKER_LINES: Record<string, 'every-line' | 'first-line'> = {
	blockquote: 'every-line',
	githubAlert: 'every-line',
	listItem: 'first-line',
	'footnote-def': 'first-line'
};
const LAZY_LINES = ['blockquote', 'githubAlert', 'listItem', 'footnote-def'];
const BUILT_IN_SHAPES: Record<string, BlockFacts['lines']> = {
	list: 'items',
	table: 'rows',
	tableRow: 'cells'
};
/** Containers a pasted one of the same kind joins, by the metadata field they share (null: any). */
const MERGE_KEYS: Record<string, string | null> = {
	blockquote: null,
	list: 'ordered',
	githubAlert: 'alertType',
	'footnote-def': 'label'
};
/** Drawn by a component that opens the text on a click, which the registration can't see. */
const PICTURES_BY_COMPONENT = ['mathBlock', 'mathFence', 'toc'];
const JOINS_BY_ROLE: Record<MergeRole, BlockFacts['joins']> = {
	prose: 'text',
	'prose-absorber': 'text-keeping-type',
	container: 'into-deepest',
	'self-merge': 'same-type',
	'not-mergeable': 'never'
};

// ── The expected facts, field by field ───────────────────────────────────────

const descriptorOf = (kind: string) => tryGetBlockKindDescriptor(kind as AnyBlockKind);
const holdsBlocks = (kind: string) => mustHoldChild(kind as AnyBlockKind);

function drawnAsPicture(kind: string): boolean {
	const view = blockViewFor(kind as AnyBlockKind, everyInstalledPlugin);
	const opensOnClick =
		view !== undefined &&
		blockViewForm(view) === 'dom' &&
		domViewSpec(view).surface === 'render-primary';
	return opensOnClick || PICTURES_BY_COMPONENT.includes(kind);
}

/** The first block of each kind in the parse of every kind's own sample. */
function samples(): Map<string, CstNode> {
	const found = new Map<string, CstNode>();
	const visit = (node: CstNode): void => {
		if (!found.has(node.kind)) found.set(node.kind, node);
		node.children?.forEach(visit);
	};
	for (const kind of getAllRegisteredKinds()) {
		const fixture = descriptorOf(kind)?.conformanceFixture;
		if (fixture) parse(fixture).children.forEach(visit);
	}
	return found;
}

const EXPECTED: { [Field in keyof BlockFacts]-?: (kind: string) => BlockFacts[Field] } = {
	container: holdsBlocks,
	lines: (kind) => {
		if (!holdsBlocks(kind)) return 'none';
		if (BUILT_IN_SHAPES[kind]) return BUILT_IN_SHAPES[kind];
		if (descriptorOf(kind)?.bodyWrap?.beforeCloserLine) return 'fenced';
		return MARKER_LINES[kind] ?? 'none';
	},
	lazyParagraphLines: (kind) => LAZY_LINES.includes(kind),
	merges: (kind) => {
		const key = isDirectiveContainerKind(kind as AnyBlockKind) ? 'name' : MERGE_KEYS[kind];
		if (key === undefined) return { into: [], onMismatch: 'nest' };
		const onMismatch = kind === 'list' ? 'break-out' : 'nest';
		return { into: [kind], ...(key === null ? {} : { key }), onMismatch };
	},
	countsMarkers: (kind) => kind === 'list',
	titleRow: (kind) => {
		const type = reservedChromeKindOf(kind as AnyBlockKind);
		if (type === undefined) return undefined;
		// The row is the opener line when the container's bytes start with the row's.
		const sample = samples().get(kind)!;
		return { type, nameNeverEntered: sample.raw.startsWith(sample.children![0].raw) };
	},
	body: (kind) =>
		descriptorOf(kind)?.supportsInline || holdsBlocks(kind) ? 'markdown' : 'literal',
	joins: (kind) => JOINS_BY_ROLE[descriptorOf(kind)!.mergeRole],
	textPosition: (kind) => {
		if (descriptorOf(kind)?.blockFocus === 'whole-block') return 'never';
		return drawnAsPicture(kind) ? 'while-source-shows' : 'always';
	}
};

// ── The rows ─────────────────────────────────────────────────────────────────

describe('block facts agree with every registration', () => {
	it('enrolls every bundled plugin directory', () => {
		expect(Object.keys(BUNDLED).sort()).toEqual(bundledPluginDirs());
	});

	it('names only registered kinds in the tables of facts nothing else states', () => {
		const registered = new Set<string>(getAllRegisteredKinds());
		const named = [
			...Object.keys(MARKER_LINES),
			...LAZY_LINES,
			...Object.keys(BUILT_IN_SHAPES),
			...Object.keys(MERGE_KEYS),
			...PICTURES_BY_COMPONENT
		];
		expect(named.filter((kind) => !registered.has(kind))).toEqual([]);
	});

	it.each(Object.keys(EXPECTED) as (keyof BlockFacts)[])('%s, for every kind', (field) => {
		const kinds = getAllRegisteredKinds();
		const actual = Object.fromEntries(kinds.map((kind) => [kind, blockFacts(kind)[field]]));
		const expected = Object.fromEntries(kinds.map((kind) => [kind, EXPECTED[field](kind)]));
		expect(actual).toEqual(expected);
	});

	// Undeclared reads as `none` on both sides, so a new container would agree with nothing said.
	it('gives every container a line shape', () => {
		const shapeless = getAllRegisteredKinds().filter(
			(kind) => blockFacts(kind).container && blockFacts(kind).lines === 'none'
		);
		expect(shapeless).toEqual([]);
	});

	// A key no parse sets reads as undefined on both sides, so every pair would merge.
	it('names, as a merge key, a field the kind’s own parse sets', () => {
		const parsed = samples();
		const unset = getAllRegisteredKinds().flatMap((kind) => {
			const { key } = blockFacts(kind).merges;
			if (key === undefined) return [];
			const metadata = parsed.get(kind)?.metadata as Record<string, unknown> | undefined;
			return metadata?.[key] === undefined ? [`${kind}.${key}`] : [];
		});
		expect(unset).toEqual([]);
	});
});

describe('a block drawn as a picture of its source', () => {
	it('has a text position only while its source shows', () => {
		expect(hasTextPosition('mathBlock', false)).toBe(false);
		expect(hasTextPosition('mathBlock', true)).toBe(true);
	});

	it('leaves a text block always reachable and a block focused whole never', () => {
		expect([false, true].map((shows) => hasTextPosition('paragraph', shows))).toEqual([true, true]);
		expect([false, true].map((shows) => hasTextPosition('thematicBreak', shows))).toEqual([
			false,
			false
		]);
	});
});
