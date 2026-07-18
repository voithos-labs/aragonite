// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '$lib/core/parser';
import { getPluginMetadata } from '$lib/core/nodes';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import {
	rebuildDirectiveContainerRaw,
	type DirectiveContainerMetadata
} from '$lib/core/directive/kinds';

// The byte round-trip holds without edits (an opaque container emits its `raw`
// verbatim). A structural edit triggers a rebuild, which synthesizes the opener
// and closer chrome lines — these must reproduce the authored line ending, not
// normalize CRLF to `\n`. The body carries its own bytes and is not at issue.

beforeAll(() => activateDirectiveGrammar());

describe('directive rebuild preserves CRLF chrome line endings', () => {
	it('captures the authored line ending at parse time', () => {
		const node = parse(':::custom info\r\nbody\r\n:::\r\n').children[0];
		expect(getPluginMetadata<DirectiveContainerMetadata>(node)?.lineEnding).toBe('\r\n');
	});

	it('reproduces CRLF on the opener and closer when a child edit rebuilds the container', () => {
		const node = parse(':::custom\r\nbody\r\n:::\r\n').children[0];

		// Structural edit: rewrite the body child, then rebuild (what a commit does).
		node.children![0].raw = 'edited\r\n';
		rebuildDirectiveContainerRaw(node);

		expect(node.raw).toBe(':::custom\r\nedited\r\n:::\r\n');
	});

	it('keeps `\\n` chrome lines for an LF-authored directive after rebuild', () => {
		const node = parse(':::custom\nbody\n:::\n').children[0];

		node.children![0].raw = 'edited\n';
		rebuildDirectiveContainerRaw(node);

		expect(node.raw).toBe(':::custom\nedited\n:::\n');
	});

	// A mixed-ending directive (LF opener, CRLF closer) keeps EACH chrome line's own
	// ending: `closerNewline` only recorded presence, so the closer's bytes used to
	// re-emit as the opener's ending and normalized on rebuild.
	it("keeps the closer's own ending when it differs from the opener", () => {
		const node = parse(':::custom\nbody\n:::\r\n').children[0];

		node.children![0].raw = 'edited\n';
		rebuildDirectiveContainerRaw(node);

		expect(node.raw).toBe(':::custom\nedited\n:::\r\n');
	});
});
