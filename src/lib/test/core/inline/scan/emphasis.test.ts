import {
	codeNode,
	describeScanCases,
	emphasisNode,
	strikethroughNode,
	strongNode,
	textNode
} from './scan-test-helpers';

describeScanCases('emphasis node shape (markers inside the range)', [
	['single-star run', '*foo*', [emphasisNode(0, 5, [textNode(1, 4, 'foo')])]],
	['double-star run', '**foo**', [strongNode(0, 7, [textNode(2, 5, 'foo')])]],
	['underscore run', '_foo_', [emphasisNode(0, 5, [textNode(1, 4, 'foo')])]],
	[
		'triple run nests strong inside emphasis; emptied run nodes drop',
		'***a***',
		[emphasisNode(0, 7, [strongNode(1, 6, [textNode(3, 4, 'a')])])]
	],
	['unmatched opener stays literal', '*a', [textNode(0, 2, '*a')]],
	[
		'punctuation-flanked nesting',
		'*(*foo*)*',
		[
			emphasisNode(0, 9, [
				textNode(1, 2, '('),
				emphasisNode(2, 7, [textNode(3, 6, 'foo')]),
				textNode(7, 8, ')')
			])
		]
	],
	[
		'interior constructs become children',
		'*a `b`*',
		[emphasisNode(0, 7, [textNode(1, 3, 'a '), codeNode(3, 6, 'b')])]
	]
]);

describeScanCases('strikethrough (GFM)', [
	['exactly-two runs pair', '~~a~~', [strikethroughNode(0, 5, [textNode(2, 3, 'a')])]],
	['single tilde stays literal', '~a~', [textNode(0, 3, '~a~')]],
	// GFM edge: only exactly-2 runs delimit, so a
	// 3-tilde run is literal — no partial consumption as with `*`.
	['three-tilde runs stay literal', '~~~a~~~', [textNode(0, 7, '~~~a~~~')]],
	[
		'sequential pairs do not chain',
		'~~a~~b~~c~~',
		[
			strikethroughNode(0, 5, [textNode(2, 3, 'a')]),
			textNode(5, 6, 'b'),
			strikethroughNode(6, 11, [textNode(8, 9, 'c')])
		]
	],
	// Distinct exactly-2 runs DO nest (only a longer run, which cannot
	// delimit, is prevented — direct `~~~~` nesting is unreachable).
	[
		'distinct runs nest',
		'~~a ~~b~~ c~~',
		[
			strikethroughNode(0, 13, [
				textNode(2, 4, 'a '),
				strikethroughNode(4, 9, [textNode(6, 7, 'b')]),
				textNode(9, 11, ' c')
			])
		]
	]
]);
