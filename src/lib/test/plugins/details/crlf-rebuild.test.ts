import { describe, it, expect, beforeEach } from 'vitest';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { getPluginMetadata } from '$lib/core/nodes';
import { __resetSchemaRegistriesForTests } from '$lib/schema/registry-reset';
import { __resetPasteSurfacesForTests } from '$lib/tree-operations/paste-surfaces';
import {
	registerDetailsKind,
	rebuildDetailsRaw,
	type DetailsMetadata
} from '$lib/plugins/details/details-kind';

// Without edits an opaque container emits its `raw` verbatim, so only `rebuildDetailsRaw`
// is at risk: the three chrome lines it SYNTHESIZES have to reproduce the authored line
// ending rather than normalize CRLF to `\n`. Mirrors `serializeDirective`'s threading.

function resetAndRegister(): void {
	__resetSchemaRegistriesForTests();
	__resetPasteSurfacesForTests();
	registerDetailsKind();
}

const CRLF_SRC = '<details>\r\n<summary>T</summary>\r\n\r\nbody\r\n\r\n</details>\r\n';
const LF_SRC = '<details>\n<summary>T</summary>\n\nbody\n\n</details>\n';

describe('details rebuild preserves CRLF chrome line endings', () => {
	beforeEach(resetAndRegister);

	it('captures the authored line ending at parse time', () => {
		const meta = getPluginMetadata<DetailsMetadata>(parse(CRLF_SRC).children[0]);
		expect(meta?.lineEnding).toBe('\r\n');
		expect(meta?.closerNewline).toBe(true);
	});

	it('reproduces CRLF on all three chrome lines after a body-child rebuild', () => {
		const details = parse(CRLF_SRC).children[0];
		// Structural edit: rewrite the body child, then rebuild (what a commit does).
		details.children![1].raw = 'edited\r\n';
		rebuildDetailsRaw(details);
		expect(details.raw).toBe(
			'<details>\r\n<summary>T</summary>\r\n\r\nedited\r\n\r\n</details>\r\n'
		);
	});

	it('reproduces CRLF chrome for an open details', () => {
		const src = '<details open>\r\n<summary>Title</summary>\r\n\r\nBody\r\n\r\n</details>\r\n';
		const details = parse(src).children[0];
		rebuildDetailsRaw(details);
		expect(details.raw).toBe(src);
	});

	it('keeps `\\n` chrome lines for an LF-authored details after rebuild (unchanged)', () => {
		const details = parse(LF_SRC).children[0];
		details.children![1].raw = 'edited\n';
		rebuildDetailsRaw(details);
		expect(details.raw).toBe('<details>\n<summary>T</summary>\n\nedited\n\n</details>\n');
	});

	it('round-trips the CRLF source byte-for-byte through parse+serialize', () => {
		expect(serialize(parse(CRLF_SRC))).toBe(CRLF_SRC);
	});
});
