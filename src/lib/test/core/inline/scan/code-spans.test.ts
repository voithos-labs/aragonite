import { describe, it, expect } from 'vitest';
import { scanInline } from '../../../../core/inline/scan';
import {
	assertTotalCoverage,
	describeScanCases,
	codeNode,
	emphasisNode,
	escapeNode,
	textNode
} from './scan-test-helpers';

describeScanCases('matched spans', [
	['span covers fences + content', '`a`', [codeNode(0, 3, 'a')]],
	['double-backtick fence', '``a``', [codeNode(0, 5, 'a')]],
	['content is raw, unfolded: flanking spaces kept', '` a `', [codeNode(0, 5, ' a ')]],
	['content is raw, unfolded: all-space content kept', '` `', [codeNode(0, 3, ' ')]],
	['content is raw, unfolded: interior newline kept', '`a\nb`', [codeNode(0, 5, 'a\nb')]],
	['entities and escapes are literal inside', '`&amp; \\*`', [codeNode(0, 10, '&amp; \\*')]],
	['shorter runs inside a longer fence are content', '`` `a` ``', [codeNode(0, 9, ' `a` ')]],
	['a longer run inside does not close', '`a```b`', [codeNode(0, 7, 'a```b')]],
	['closing search ignores backslashes (§6.5)', '`a\\`', [codeNode(0, 4, 'a\\')]]
]);

describeScanCases('unmatched runs stay literal text', [
	['opener longer than closer', '``a`', [textNode(0, 4, '``a`')]],
	['closer longer than opener', '`a``', [textNode(0, 4, '`a``')]],
	['bare run', '``', [textNode(0, 2, '``')]],
	[
		'matched span followed by unmatched run',
		'`a` `b',
		[codeNode(0, 3, 'a'), textNode(3, 6, ' `b')]
	],
	['escaped backtick leaves the closer unmatched', '\\`a`', [escapeNode(0), textNode(2, 4, 'a`')]]
]);

describeScanCases('interleaving', [
	[
		'backticks bind before the emphasis pass sees the interior',
		'*`a`*',
		[emphasisNode(0, 5, [codeNode(1, 4, 'a')])]
	]
]);

describe('ranges', () => {
	it('span offsets stay absolute on a sub-range', () => {
		const nodes = scanInline('x `a` y', 2, 5);
		assertTotalCoverage(nodes, 2, 5);
		expect(nodes).toEqual([codeNode(2, 5, 'a')]);
	});

	it('escape lookback is clamped to the range start', () => {
		// Unreachable via any current getContentRange, but pinned so it cannot silently
		// flip: an out-of-range `\` must not suppress a span inside the range.
		const nodes = scanInline('x\\`a`', 2, 5);
		assertTotalCoverage(nodes, 2, 5);
		expect(nodes).toEqual([codeNode(2, 5, 'a')]);
	});
});
