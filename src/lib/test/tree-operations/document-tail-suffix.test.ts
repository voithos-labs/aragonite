import { deleteNode } from '#lib/tree-operations/node-ops.js';
import { updateNodeContent } from '#lib/tree-operations/content-write.js';
import { describe, it, expect } from 'vitest';
import { parse } from '../../core/parser';
import { serialize } from '../../core/serializer';
import { splitNode } from '../../tree-operations';
import { documentBody, emptyParagraph } from '../../tree-operations/node-primitives';
import { fixUpWrite } from '#lib/tree-operations/fix-up/apply.js';
import { describeConvergence } from '#lib/test/harness/parse-converged.js';
import { settled } from '#lib/test/harness/settle-funnel.js';
import { fixtureReading } from '../harness/fixture-grammar';
import { defaultGrammarView } from '#lib/schema/block-openers.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';

// The parser keeps a document's one trailing blank line in `doc.suffix` only while the tail block
// is non-blank, so when a gesture blanks the tail, the fix-up drops that line, as it drops the
// separator under any blank block; only a document left with no block takes the line as one.
// Miss-analysis: the shape property's corpus always ended on a block, so no row blanked the tail.

describe('the folded trailing blank goes when the tail turns blank', () => {
	it('emptying the only block drops the suffix line and keeps the one block', () => {
		const doc = parse('foo\n\n');
		expect(doc.children).toHaveLength(1);
		expect(doc.suffix).toBe('\n');

		const { change } = updateNodeContent(doc, 0, '\n', defaultGrammarView, createSharingState());

		expect(doc.children.map((c) => [c.leadingTrivia, c.raw])).toEqual([['', '\n']]);
		expect(doc.suffix).toBe('');
		expect(serialize(doc)).toBe('\n');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'noop' });
	});

	it('the CRLF variant drops its CRLF line', () => {
		const doc = parse('foo\r\n\r\n');

		updateNodeContent(doc, 0, '\r\n', defaultGrammarView, createSharingState());

		expect(doc.children.map((c) => c.raw)).toEqual(['\r\n']);
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
	});

	// The structural writes get a body parent with no suffix, so the fix-up is what drops the line,
	// and both cases below report the window the commit writes out.
	it('a split whose blank second half lands at the tail adds that block alone', () => {
		const doc = parse('foo*42*_lorem_  \r\n\n');
		expect(doc.children).toHaveLength(1);

		const change = settled(
			doc,
			(body) => splitNode(body, 0, 14, createSharingState(), fixtureReading()).change
		);

		expect(serialize(doc)).toBe('foo*42*_lorem_\r\n\r\n  \r\n');
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 1, newCount: 2, idMap: { 0: 0 } });
	});

	it('deleting the tail block leaves the blank block above it last', () => {
		const doc = parse('a\n\n\nb\n\n');
		expect(doc.children.map((c) => c.raw)).toEqual(['a\n', '\n', 'b\n']);
		expect(doc.suffix).toBe('\n');

		const change = settled(doc, (body) => ({
			change: deleteNode(body, 2, createSharingState()),
			removed: true
		}));

		expect(serialize(doc)).toBe('a\n\n\n');
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'delete', at: 2, count: 1 });
	});

	// The whole document gone: no tail is left for the line to attach to, so it is the one
	// block the reload reads and the fix-up must create it.
	it('deleting the only block materializes the folded line rather than emptying the tree', () => {
		const doc = parse('a\n\n');

		const change = settled(doc, (body) => ({
			change: deleteNode(body, 0, createSharingState()),
			removed: true
		}));

		expect(doc.children.map((c) => c.raw)).toEqual(['\n']);
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 1, newCount: 1 });
	});

	// The full-table delete fills the emptied document itself, so its filler is the blank tail and
	// the window that caller reported stays as it was.
	it('keeps a caller-created filler as the one block when the folded line goes', () => {
		const doc = parse('| H |\n| - |\n\n');

		const change = settled(doc, (body) => {
			deleteNode(body, 0, createSharingState());
			body.children.push(emptyParagraph('', '\n'));
			return { op: 'replace', at: 0, count: 1, newCount: 1 };
		});

		expect(doc.children.map((c) => c.raw)).toEqual(['\n']);
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
		expect(change).toEqual({ op: 'replace', at: 0, count: 1, newCount: 1 });
	});

	// The whole-content range delete's path: `rangeDelete`'s same-block branch writes the blank
	// and goes through this fix-up, so the rule must live in the fix-up for it to inherit.
	it('the fix-up itself drops the line on a document parent', () => {
		const doc = parse('foo bar\n\n');
		const previous = doc.children[0];
		doc.children[0] = { ...previous, raw: '\n' };

		fixUpWrite(
			documentBody(doc),
			{ index: 0, previous, text: '\n' },
			{ op: 'noop' },
			defaultGrammarView,
			createSharingState()
		);

		expect(doc.children).toHaveLength(1);
		expect(doc.suffix).toBe('');
		expect(describeConvergence(doc)).toBeNull();
	});

	it('a non-tail edit leaves the folded suffix alone', () => {
		const doc = parse('a\n\nb\n\n');
		expect(doc.children).toHaveLength(2);

		const { change } = updateNodeContent(doc, 0, '\n', defaultGrammarView, createSharingState());

		expect(doc.suffix).toBe('\n');
		expect(change).toEqual({ op: 'noop' });
		expect(describeConvergence(doc)).toBeNull();
	});
});
