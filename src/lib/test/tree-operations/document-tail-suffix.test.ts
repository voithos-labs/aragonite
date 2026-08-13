import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { deleteNode, splitNode, updateNodeContent } from '../../tree-operations';
import { settleSeparatorOnBlank } from '../../tree-operations/node-ops';
import { describeConvergence } from '$lib/test/harness/parse-converged';
import { settled } from '$lib/test/harness/settle-funnel';

// GH #129: the parse folds a document's one trailing blank line into `doc.suffix` only while
// the tail block is non-blank; when a gesture blanks the tail, the reload reads that line as
// its own empty paragraph, so the settle must materialize it.
// Miss-analysis: the shape lane's corpus always ends on a block, so no draw ever placed the
// parse-folded suffix beside a tail a gesture then blanked.

describe('the folded trailing blank materializes when the tail turns blank (GH #129)', () => {
	it('emptying the only block appends the suffix line and reports the insert', () => {
		const doc = parse('foo\n\n');
		expect(doc.children).toHaveLength(1);
		expect(doc.suffix).toBe('\n');

		const change = updateNodeContent(doc, 0, '\n');

		expect(doc.children.map((c) => [c.leadingTrivia, c.raw])).toEqual([
			['', '\n'],
			['', '\n']
		]);
		expect(doc.suffix).toBe('');
		expect(serialize(doc)).toBe('\n\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'insert', at: 1, count: 1 });
	});

	it('the CRLF twin materializes its CRLF line', () => {
		const doc = parse('foo\r\n\r\n');

		updateNodeContent(doc, 0, '\r\n');

		expect(doc.children.map((c) => c.raw)).toEqual(['\r\n', '\r\n']);
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
	});

	// The structural sinks are handed a slotless body parent, so the mint is the settle's alone
	// (GH #168): both cases below report the widened window the ceremony publishes.
	it('a split whose blank second half lands at the tail widens its window', () => {
		const doc = parse('foo*42*_lorem_  \r\n\n');
		expect(doc.children).toHaveLength(1);

		const change = settled(
			doc,
			(body) => splitNode(body, 0, 14, undefined, undefined, undefined).change
		);

		expect(doc.children).toHaveLength(3);
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 1, newCount: 3, idMap: { 0: 0 } });
	});

	it('deleting the tail block hands the new blank tail its line as a replace', () => {
		const doc = parse('a\n\n\nb\n\n');
		expect(doc.children.map((c) => c.raw)).toEqual(['a\n', '\n', 'b\n']);
		expect(doc.suffix).toBe('\n');

		const change = settled(doc, (body) => deleteNode(body, 2));

		expect(doc.children).toHaveLength(3);
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 2, count: 1, newCount: 1 });
	});

	// The whole document gone: no tail is left for the line to fold against, so it is the one
	// block the reload reads and the settle must mint it.
	it('deleting the only block materializes the folded line rather than emptying the tree', () => {
		const doc = parse('a\n\n');

		const change = settled(doc, (body) => deleteNode(body, 0));

		expect(doc.children.map((c) => c.raw)).toEqual(['\n']);
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 1, newCount: 1 });
	});

	// The whole-content range delete's door: `rangeDelete`'s same-block arm writes the blank
	// and settles through this seam, so the arm must live in the settle for it to inherit.
	it('the settle itself materializes on a document parent', () => {
		const doc = parse('foo bar\n\n');
		doc.children[0].raw = '\n';

		settleSeparatorOnBlank(doc, 0);

		expect(doc.children).toHaveLength(2);
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a non-tail edit leaves the folded suffix alone', () => {
		const doc = parse('a\n\nb\n\n');
		expect(doc.children).toHaveLength(2);

		const change = updateNodeContent(doc, 0, '\n');

		expect(doc.suffix).toBe('\n');
		expect(change).toEqual({ op: 'noop' });
		expect(describeConvergence(doc)).toBeNull();
	});
});
