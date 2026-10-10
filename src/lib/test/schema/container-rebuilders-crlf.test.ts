// A container rebuild re-emits bytes the keystroke never touched, so it must reproduce the
// source's line endings exactly (G4.20). Fixtures come from `parse`, since a hand-built child raw
// would agree with a rebuilder that splits a CRLF body wrong.
import { describe, it, expect } from 'vitest';
import { rebuildBlockquoteRaw, rebuildListItemRaw } from '../../schema/container-rebuilders';
import { parse } from '../../core/parser';

describe('rebuildBlockquoteRaw over a CRLF source', () => {
	it('re-emits a blank quote line as `>` + CRLF, not `> ` + CR', () => {
		const node = parse('> a\r\n>\r\n> b\r\n').children[0];
		rebuildBlockquoteRaw(node);
		expect(node.raw).toBe('> a\r\n>\r\n> b\r\n');
	});

	it('re-emits a multi-line quoted paragraph with its CRLF endings', () => {
		const node = parse('> one\r\n> two\r\n').children[0];
		rebuildBlockquoteRaw(node);
		expect(node.raw).toBe('> one\r\n> two\r\n');
	});
});

describe('rebuildListItemRaw over a CRLF source', () => {
	it('leaves a blank continuation line unindented instead of emitting the indent + CR', () => {
		const item = parse('- a\r\n\r\n  b\r\n').children[0].children![0];
		rebuildListItemRaw(item);
		expect(item.raw).toBe('- a\r\n\r\n  b\r\n');
	});
});
