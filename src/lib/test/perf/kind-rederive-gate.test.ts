// A container parse costs its whole raw, so a keystroke pays one only when an outer line moved
// and something can follow from it: the opener line's answer changed (a new kind), or an opaque
// container's metadata may have (any outer line but a title row's). That keeps a keystroke off
// the container-size axis: typing into a list's first item or a directive's title parses nothing.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installPlugins } from '#lib';
import { admonitionsPlugin } from '#lib/plugins/admonitions/index.js';
import { parse } from '#lib/core/parser.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { ensureUnsharedPath } from '#lib/tree-operations/unshare.js';
import { rebuildUnsharedChain } from '#lib/tree-operations/chain-rebuild.js';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '#lib/perf/instruments.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { documentLineEnding } from '#lib/core/lines.js';
import { docPathFrom } from '#lib/caret/coordinate-spaces.js';
import { createUndoController } from '#lib/editor-actions/commit/undo-controller.js';
import { createLeafTyping } from '#lib/editor-actions/leaf-write.js';
import { legalizeWrite } from '#lib/tree-operations/content-write.js';
import { makeEditorActionsDeps } from '#lib/test/harness/editor-actions.js';
import type { CstNode, Document } from '#lib/core/nodes.js';
import {
	chromeChild,
	declarePluginKind,
	OPENER_PRIORITIES,
	parseContainerBody,
	registerBlockOpener,
	registerChromeLeaf,
	serializeChildren as concatChildren,
	setPluginMetadata,
	trimTrailingLineEnding
} from '#lib/plugin.js';
import { describeConvergence } from '#lib/testing/parse-convergence.js';
import { testContainer } from '#lib/test/harness/test-kinds.js';

// ── A fence that prints its body's size on the opener line ──────────────────
// `==[5] Title` … `==[end Title]`: a body keystroke moves only the opener, and the size in
// metadata comes from that line, so these kinds pin each half of the title-row skip.

interface TallyMetadata {
	size: number;
}

function registerTally(name: string, titled: boolean): void {
	const rebuild = (node: CstNode): void => {
		const children = node.children ?? [];
		const title = titled ? ` ${trimTrailingLineEnding(children[0].raw)}` : '';
		const body = concatChildren(titled ? children.slice(1) : children);
		node.raw = `==[${body.length}]${title}\n${body}==[end${title}]\n`;
	};
	const chrome = titled ? declarePluginKind(`${name}-title`) : undefined;
	if (chrome) registerChromeLeaf(chrome);
	const kind = chrome
		? testContainer(name, { rebuildRaw: rebuild, reservedChrome: { kind: chrome } })
		: testContainer(name, { rebuildRaw: rebuild });
	registerBlockOpener(kind, {
		priority: OPENER_PRIORITIES.fencedCode - (titled ? 8 : 9),
		interruptsParagraph: false,
		tryOpen(ctx) {
			const open = /^==\[(\d+)\](?: (.*))?$/.exec(ctx.line.text);
			if (!open || (open[2] !== undefined) !== titled) return null;
			let close = ctx.index + 1;
			while (close < ctx.end && !ctx.lines[close].text.startsWith('==[end')) close++;
			// The titled kind opens on a lone line too, so its kind check never parses and only the
			// metadata re-read can.
			const closed = close < ctx.end;
			if (!closed && !titled) return null;
			const lines = ctx.lines.slice(ctx.index, closed ? close + 1 : ctx.end);
			const bodyText = lines
				.slice(1, closed ? -1 : undefined)
				.map((l) => l.raw)
				.join('');
			const body = parseContainerBody(bodyText, {}, { scope: 'fragment', grammar: ctx.grammar });
			const node: CstNode = {
				kind,
				leadingTrivia: ctx.leadingTrivia,
				raw: lines.map((l) => l.raw).join(''),
				children: chrome ? [chromeChild(chrome, open[2]), ...body.children] : body.children
			};
			setPluginMetadata<TallyMetadata>(node, { size: Number(open[1]) });
			return { node, consumed: lines.length };
		}
	});
}

const KEYSTROKES = 20;

/** Type `count` characters into the leaf at `leafPath`, one rebuild each. */
function typeInto(source: string, leafPath: number[], count: number): void {
	const doc = parse(source);
	const sharing = createSharingState();
	let text = '';
	for (let i = 0; i < count; i++) {
		text += 'x';
		const chain = ensureUnsharedPath(doc, leafPath, sharing);
		chain[chain.length - 1].raw = `${text}\n`;
		rebuildUnsharedChain(doc, chain, sharing, null, defaultGrammarView);
	}
}

/** Write each of `raws` into child `index` of the top-level container through the keystroke's
 *  in-place route, which names the changed child to the rebuild. */
function typeInPlace(source: string, index: number, raws: string[]): Document {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createLeafTyping(deps, createUndoController(deps));
	for (const raw of raws) {
		const owner = deps.doc.children[0];
		const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
		const write = legalizeWrite(body, index, raw, 'authored');
		expect(typing.writeLeafInPlace(docPathFrom([0, index]), write, 0).wrote).toBe(true);
	}
	return deps.doc;
}

/** `count` growing lines, `base` plus one more `x` each time. */
const growing = (base: string, count: number): string[] =>
	Array.from({ length: count }, (_, i) => `${base}${'x'.repeat(i + 1)}\n`);

const reparses = () => perfSnapshot().containerKindReparses;

beforeEach(() => {
	installPlugins([admonitionsPlugin()]);
	registerTally('tally', false);
	registerTally('titled-tally', true);
});

beforeEach(() => {
	resetPerfInstruments();
	enablePerfInstruments();
});
afterEach(() => disablePerfInstruments());

describe('container kind re-derivation gate', () => {
	it('reparses nothing while typing outside the container opener line', () => {
		typeInto('> head\n>\n> body\n', [0, 1], KEYSTROKES);

		expect(perfSnapshot().rebuildDepths).toEqual({ 2: KEYSTROKES });
		expect(reparses()).toBe(0);
	});

	// Each of these rewrites the container's opener line on every keystroke without changing the
	// opener's answer, so only the second condition keeps them from reparsing.
	it.each([
		['blockquote first paragraph', '> head\n>\n> body\n', [0, 0]],
		['list first item', '- one\n- two\n- three\n', [0, 0, 0]]
	])('reparses nothing while typing into the %s', (_label, source, leafPath) => {
		typeInto(source, leafPath, KEYSTROKES);

		expect(reparses()).toBe(0);
	});

	// A directive's opener declines a lone line (it wants its `:::` closer), so only the first
	// condition applies, and typing in the body never touches the line with the directive name.
	it('reparses nothing while typing into a directive container body', () => {
		typeInto(':::spoiler\n\nbody\n\n:::\n', [0, 0], KEYSTROKES);

		expect(reparses()).toBe(0);
	});

	// The metadata an opaque container keeps never comes from its title row, and its body sits
	// between the fence lines; only a moved closer, a lengthened fence, pays a parse.
	it('reparses nothing while typing into a titled directive title', () => {
		typeInPlace(':::note Title\nbody\n:::\n', 0, growing('Title', KEYSTROKES));

		expect(reparses()).toBe(0);
	});

	it('reparses nothing while typing into a titled directive body', () => {
		typeInPlace(':::note Title\nbody\n:::\n', 1, growing('body', KEYSTROKES));

		expect(reparses()).toBe(0);
	});

	it('reparses once for the keystroke that lengthens a titled directive fence', () => {
		typeInPlace(':::note Title\nbody\n:::\n', 1, ['body\n:::\n']);

		expect(reparses()).toBe(1);
	});

	// Each keystroke below moves an outer line the metadata does come from, so dropping any one
	// half of the title-row skip leaves a stale size or a missing parse.
	it.each([
		['a title keystroke that also moves the closer', '==[5] T\nbody\n==[end T]\n', 0, 'Tx\n'],
		['a body keystroke in a titled container', '==[5] T\nbody\n==[end T]\n', 1, 'bodyx\n'],
		[
			'a keystroke in child 0 of a container with no title row',
			'==[5]\nbody\n==[end]\n',
			0,
			'bodyx\n'
		]
	])('reparses once for %s', (_label, source, index, raw) => {
		const doc = typeInPlace(source, index, [raw]);

		expect(reparses()).toBe(1);
		expect(describeConvergence(doc)).toBeNull();
	});

	// Only the keystroke that closes the marker changes the answer. The trailing `x` keeps one
	// keystroke after that in the run, so a check that stayed open once opened over-counts here.
	it('reparses only on the keystroke that moves the opener verdict', () => {
		const doc = parse('> [!TI\n');
		const sharing = createSharingState();
		let text = '[!TI';
		for (const char of 'P]x') {
			text += char;
			const chain = ensureUnsharedPath(doc, [0, 0], sharing);
			chain[chain.length - 1].raw = `${text}\n`;
			rebuildUnsharedChain(doc, chain, sharing, null, defaultGrammarView);
		}

		expect(doc.children[0].kind).toBe('githubAlert');
		expect(reparses()).toBe(1);
	});
});
