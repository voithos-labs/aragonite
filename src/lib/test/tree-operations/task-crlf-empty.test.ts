// Miss-analysis: the task-marker tests wrote LF paragraphs, and the shape property skipped list-item
// bodies, so no test emptied a CRLF to-do, where the marker's whitespace match took the `\r`.
import { describe, it, expect } from 'vitest';
import type { Document } from '$lib/core/nodes';
import { parse } from '$lib/core/parser';
import { serialize } from '$lib/core/serializer';
import { updateNodeContent } from '$lib/tree-operations';
import { getBlockKindDescriptor } from '$lib/schema/block-kind-descriptor';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { documentLineEnding } from '$lib/core/lines';

// A CRLF to-do keeps its own line ending through being emptied and typed into again (G4.20): the
// marker is `[x] ` and nothing more, and the paragraph keeps the `\r\n`.

/** Write `text` into the first paragraph of the list's `item`-th item, then rebuild up the chain. */
function writeTaskText(doc: Document, listIndex: number, item: number, text: string): void {
	const list = doc.children[listIndex];
	const owner = list.children![item];
	updateNodeContent(
		{
			children: owner.children!,
			ownerKind: owner.kind,
			owner,
			lineEnding: documentLineEnding(doc)
		},
		0,
		text
	);
	getBlockKindDescriptor('listItem').rebuildRaw?.(owner);
	getBlockKindDescriptor('list').rebuildRaw?.(list);
}

describe('emptying a CRLF task item', () => {
	it('keeps the marker and the line ending apart, and the next keystroke writes CRLF', () => {
		const doc = parse('- [x] foo\r\n');

		writeTaskText(doc, 0, 0, '\r\n');
		expect(serialize(doc)).toBe('- [x] \r\n');
		expect(doc.children[0].children![0].metadata).toMatchObject({ taskMarker: '[x] ' });
		expect(describeConvergence(doc)).toBeNull();

		writeTaskText(doc, 0, 0, 'x\r\n');
		expect(serialize(doc)).toBe('- [x] x\r\n');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('leaves the rest of a CRLF document as it was', () => {
		const doc = parse('para\r\n\r\n- [x] foo\r\n- [ ] bar\r\n');

		writeTaskText(doc, 1, 0, '\r\n');
		writeTaskText(doc, 1, 0, 'x\r\n');

		expect(serialize(doc)).toBe('para\r\n\r\n- [x] x\r\n- [ ] bar\r\n');
		expect(describeConvergence(doc)).toBeNull();
	});
});
