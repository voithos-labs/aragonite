import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { installPlugins } from '$lib';
import { admonitionsPlugin } from '$lib/plugins/admonitions';
import { parse } from '$lib/core/parser';
import { createSharingState } from '$lib/tree-operations/sharing';
import { ensureUnsharedPath, rebuildUnsharedChain } from '$lib/tree-operations/unshare';
import {
	disablePerfInstruments,
	enablePerfInstruments,
	perfSnapshot,
	resetPerfInstruments
} from '$lib/perf/instruments';

// The kind re-derivation costs a `parse` of the container's WHOLE raw — linear in
// container bytes — so it is gated twice: the container's first line must have
// changed across its rebuild, AND that line's opener verdict (what the grammar
// opens the line as, read in isolation) must have moved. The second gate is what
// keeps keystroke cost off the container-size axis: typing into a list's first item
// or a callout title rewrites the opener line on every keystroke without moving any
// verdict.

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
		rebuildUnsharedChain(doc, chain, sharing);
	}
}

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

	// First gate passes, second holds. Each of these rewrites the container's opener
	// line on every keystroke — a blockquote's first paragraph shares it, a list item's
	// text rides its marker line, a reserved-chrome title lives IN it — and none can
	// move what that line opens as. These are the rows that put the cost on the
	// container-size axis when only the first gate exists.
	it.each([
		['blockquote first paragraph', '> head\n>\n> body\n', [0, 0]],
		['list first item', '- one\n- two\n- three\n', [0, 0, 0]],
		['reserved-chrome title', ':::note Title\n\nbody\n\n:::\n', [0, 0]]
	])('reparses nothing while typing into the %s', (_label, source, leafPath) => {
		typeInto(source, leafPath, KEYSTROKES);

		expect(reparses()).toBe(0);
	});

	// The arm the pass exists for: exactly the keystroke that closes the marker moves
	// the opener verdict, and only it pays the container reparse. The trailing `x`
	// keeps a post-formation keystroke in the stream, so a gate that latched open
	// would over-count.
	it('reparses only on the keystroke that moves the opener verdict', () => {
		const doc = parse('> [!TI\n');
		const sharing = createSharingState();
		let text = '[!TI';
		for (const char of 'P]x') {
			text += char;
			const chain = ensureUnsharedPath(doc, [0, 0], sharing);
			chain[chain.length - 1].raw = `${text}\n`;
			rebuildUnsharedChain(doc, chain, sharing);
		}

		expect(doc.children[0].kind).toBe('githubAlert');
		expect(reparses()).toBe(1);
	});
});
