// A write into the block that holds a file's open end, then the commit's tail step, leaves the
// bytes the same write leaves in the file with a final line break, less that break unless the line
// left last is blank (`docs/design/syntax-tree.md` § The last line).
// Miss-analysis: every write row at an open end left its last line text or emptied a whole
// paragraph, so no row left an empty line under a block's other lines, where the write's line
// ending read as the block's own and the tail step took it off.
import { describe, it, expect } from 'vitest';
import { parse } from '#lib/core/parser.js';
import { serialize } from '#lib/core/serializer.js';
import { endsOpen, keepOpenTail } from '#lib/tree-operations/fix-up/apply.js';
import { updateNodeContent } from '#lib/tree-operations/content-write.js';
import { documentBody } from '#lib/tree-operations/node-primitives.js';
import { createSharingState } from '#lib/tree-operations/sharing.js';
import { defaultGrammarView } from '#lib/schema/block-openers.js';

/** `source` after its block at `index` takes `text`, as a keystroke's commit writes it. */
function written(source: string, index: number, text: string): string {
	const doc = parse(source);
	const wasOpen = endsOpen(doc);
	const sharing = createSharingState();
	const body = documentBody(doc);
	updateNodeContent(body, index, text, defaultGrammarView, sharing);
	doc.children = body.children;
	keepOpenTail(doc, wasOpen, sharing, defaultGrammarView);
	return serialize(doc);
}

describe('a write at the open end ends as in the file with a final line break', () => {
	it.each([
		['a second line emptied', 'above\npq', 0, 'above\n', 'above\n\n'],
		['its twin with a final break', 'above\npq\n', 0, 'above\n\n', 'above\n\n'],
		['a code body’s last line emptied', '```\npq', 0, '```\n', '```\n\n'],
		['a line opened at a code body’s end', '```\npq', 0, '```\npq\n', '```\npq\n\n'],
		['a paragraph emptied whole under a blank line', 'zz\n\nab', 1, '', 'zz\n\n\n']
	])('%s keeps the blank last line’s break', (_, source, index, text, after) => {
		expect(written(source, index, text)).toBe(after);
	});

	it.each([
		['a letter typed on the last line', 'above\npq', 0, 'above\npqx', 'above\npqx'],
		['the only block emptied', 'ab', 0, '', ''],
		['a heading’s text emptied', 'zz\n\n# ab', 1, '# ', 'zz\n\n# '],
		['a fence opener, which no block below closes', 'zz\n\n``', 1, '```', 'zz\n\n```']
	])('%s keeps the file open', (_, source, index, text, after) => {
		expect(written(source, index, text)).toBe(after);
	});
});
