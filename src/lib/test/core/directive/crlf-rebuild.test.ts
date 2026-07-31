// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { parse } from '$lib/core/parser';
import { getPluginMetadata } from '$lib/core/nodes';
import { activateDirectiveGrammar } from '$lib/core/directive/activate';
import {
	rebuildDirectiveContainerRaw,
	type DirectiveContainerMetadata
} from '$lib/core/directive/kinds';

// Only a rebuild is at risk: an unedited container emits `raw` verbatim, but a structural
// edit re-synthesizes the chrome lines, which must not normalize CRLF to `\n`.

beforeAll(() => activateDirectiveGrammar());

describe('directive rebuild preserves CRLF chrome line endings', () => {
	it('captures the authored line ending at parse time', () => {
		const node = parse(':::custom info\r\nbody\r\n:::\r\n').children[0];
		expect(getPluginMetadata<DirectiveContainerMetadata>(node)?.lineEnding).toBe('\r\n');
	});

	it('reproduces CRLF on the opener and closer when a child edit rebuilds the container', () => {
		const node = parse(':::custom\r\nbody\r\n:::\r\n').children[0];

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

	// EACH chrome line keeps its own ending: a `closerNewline` that records only presence
	// re-emits the closer with the opener's ending.
	it("keeps the closer's own ending when it differs from the opener", () => {
		const node = parse(':::custom\nbody\n:::\r\n').children[0];

		node.children![0].raw = 'edited\n';
		rebuildDirectiveContainerRaw(node);

		expect(node.raw).toBe(':::custom\nedited\n:::\r\n');
	});
});
