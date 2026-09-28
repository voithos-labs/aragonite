import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { parse } from '$lib/core/parser';
import { createSharingState } from '$lib/tree-operations/sharing';
import { ensureUnsharedPath } from '$lib/tree-operations/unshare';
import { rebuildUnsharedChain } from '$lib/tree-operations/chain-rebuild';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '$lib/perf/instruments';
import { defaultGrammarView } from '$lib/schema/block-openers';
import { documentLineEnding } from '$lib/core/lines';
import { docPathFrom } from '$lib/cursor/coordinate-spaces';
import { createUndoController } from '$lib/editor-actions/commit/undo-controller';
import { createLeafTyping } from '$lib/editor-actions/leaf-write';
import { legalizeWrite } from '$lib/tree-operations/content-write';
import { makeEditorActionsDeps } from '$lib/test/harness/editor-actions';

// A container parse costs its whole raw, so a keystroke pays one only when an outer line moved
// and something can follow from it: the opener line's answer changed (a new kind), or an opaque
// container's metadata may have (any outer line but a title row's). That keeps a keystroke off
// the container-size axis: typing into a list's first item or a directive's title parses nothing.

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
function typeInPlace(source: string, index: number, raws: string[]): void {
	const { deps } = makeEditorActionsDeps(source);
	const typing = createLeafTyping(deps, createUndoController(deps));
	for (const raw of raws) {
		const owner = deps.doc.children[0];
		const body = { children: owner.children!, owner, lineEnding: documentLineEnding(deps.doc) };
		const write = legalizeWrite(body, index, raw, 'authored');
		expect(typing.writeLeafInPlace(docPathFrom([0, index]), write, 0).wrote).toBe(true);
	}
}

/** `count` growing lines, `base` plus one more `x` each time. */
const growing = (base: string, count: number): string[] =>
	Array.from({ length: count }, (_, i) => `${base}${'x'.repeat(i + 1)}\n`);

const reparses = () => perfSnapshot().containerKindReparses;

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
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
