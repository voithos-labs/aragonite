import { describe, it, expect, beforeEach } from 'vitest';
import { parse, serialize } from '$lib';
import { resetPluginPlatformForTests } from '$lib/testing';
import { normalizeOwnRaw } from '$lib/tree-operations/node-primitives';
import { documentLineEnding } from '$lib/plugin';
import { rangeDelete } from '$lib/selection/range-delete';
import { createSharingState } from '$lib/tree-operations/sharing';
import { registerMermaidKind } from '$lib/plugins/mermaid/mermaid-kind';
import { fixtureLinkRef } from '../../harness/fixture-grammar';

// The mermaid kind declares a raw-write rule that puts back a closing fence a truncating write
// dropped, so bytes written past the diagram's own editor cannot swallow the blocks below it.
// Miss-analysis: every mermaid write test went through the code editor's metadata commit, and
// the raw-write rule's pins covered the kinds that declared it, not the ones that did not.

/** The rule as a write path reaches it: dispatched off the node's own kind. */
function write(source: string, raw: string): string {
	const doc = parse(source);
	return normalizeOwnRaw(doc.children[0], raw, documentLineEnding(doc));
}

beforeEach(() => {
	resetPluginPlatformForTests();
	registerMermaidKind();
});

describe('a truncating write of a mermaid block gets its closing fence back', () => {
	it('a range delete from the body into the next block leaves the block after it standing', () => {
		const doc = parse('Before\n\n```mermaid\ngraph TD\n```\n\nAfter\n\nTail\n');

		// From just after the opener line into "After", which leaves "er".
		rangeDelete(
			doc,
			{ path: [1], offset: 11 },
			{ path: [2], offset: 3 },
			createSharingState(),
			undefined,
			undefined,
			fixtureLinkRef()
		);

		expect(serialize(doc)).toBe('Before\n\n```mermaid\ner\n```\n\nTail\n');
		expect(parse(serialize(doc)).children.map((c) => c.kind)).toEqual([
			'paragraph',
			'mermaid',
			'paragraph'
		]);
	});

	it.each([
		[
			'a paste over the closer',
			'```mermaid\ngraph TD\n```\n',
			'```mermaid\nA\nB',
			'```mermaid\nA\nB\n```'
		],
		[
			'a longer written opener run',
			'```mermaid\ngraph TD\n```\n',
			'````mermaid\nA\n',
			'````mermaid\nA\n````\n'
		],
		['a tilde fence', '~~~mermaid\ngraph TD\n~~~\n', '~~~mermaid\nA\n', '~~~mermaid\nA\n~~~\n'],
		[
			'an indented opener',
			'  ```mermaid\ngraph TD\n  ```\n',
			'  ```mermaid\nA\n',
			'  ```mermaid\nA\n  ```\n'
		],
		[
			'a CRLF block',
			'```mermaid\r\ngraph TD\r\n```\r\n',
			'```mermaid\r\nA\r\n',
			'```mermaid\r\nA\r\n```\r\n'
		],
		[
			'a write cut back to the opener',
			'```mermaid\ngraph TD\n```\n',
			'```mermaid\n',
			'```mermaid\n```\n'
		]
	])('%s', (_case, source, written, expected) => {
		expect(write(source, written)).toBe(expected);
		expect(parse(write(source, written) + '\nTail\n').children.map((c) => c.kind)).toEqual([
			'mermaid',
			'paragraph'
		]);
	});

	it.each([
		['a fence that still holds its closer', '```mermaid\nA\n```\n'],
		['a first line that no longer opens the block', 'graph TD\n```\n'],
		['a fence whose info string is no longer mermaid', '```js\nA\n']
	])('leaves %s alone', (_case, written) => {
		expect(write('```mermaid\ngraph TD\n```\n', written)).toBe(written);
	});

	// Applied twice by two write paths in one operation, the second pass must add nothing.
	it('is idempotent', () => {
		const once = write('```mermaid\ngraph TD\n```\n', '```mermaid\nA\n');
		expect(once).toBe('```mermaid\nA\n```\n');
		expect(write('```mermaid\ngraph TD\n```\n', once)).toBe(once);
	});
});

// Miss-analysis: every closer-restore fixture was LF, so a closer written in LF into a CRLF block
// read as correct; the last line of a document carries no ending to copy.
describe('a closing fence restored into the unterminated last block of a CRLF document', () => {
	it('is CRLF', () => {
		expect(write('```mermaid\r\ngraph TD\r\n```', '```mermaid\r\nA')).toBe(
			'```mermaid\r\nA\r\n```'
		);
	});
});
