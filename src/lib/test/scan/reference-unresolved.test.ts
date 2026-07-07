import {
	describeScanCases,
	emphasisNode,
	resolverOf,
	textNode,
	unresolvedRefNode
} from './scan-test-helpers';

// unresolvedReference (editor-specific, invisible to commonmark): a full or
// collapsed reference whose label misses the resolver commits to one opaque
// node over the whole construct — inner nodes are discarded, matching the old
// parser. Shortcut misses stay literal; without a resolver nothing commits.

const MISSES = resolverOf({ other: { url: '/other' } });

describeScanCases(
	'lookup miss commits full/collapsed forms to unresolvedReference',
	[
		[
			'full form covers the whole construct',
			'x [foo][bar] y',
			[textNode(0, 2, 'x '), unresolvedRefNode(2, 12, 'bar', 'link'), textNode(12, 14, ' y')]
		],
		['collapsed form uses the text as label', '[foo][]', [unresolvedRefNode(0, 7, 'foo', 'link')]],
		['full image form', '![foo][bar]', [unresolvedRefNode(0, 11, 'bar', 'image')]],
		['collapsed image form', '![foo][]', [unresolvedRefNode(0, 8, 'foo', 'image')]],
		['shortcut miss stays literal', '[foo]', [textNode(0, 5, '[foo]')]],
		['the label field is normalized', '[x][A  B]', [unresolvedRefNode(0, 9, 'a b', 'link')]],
		[
			'inner constructs are discarded inside the opaque node',
			'[`c` *a*][bar]',
			[unresolvedRefNode(0, 14, 'bar', 'link')]
		],
		[
			'delimiters outside the construct still pair around it',
			'*x [a][bar] y*',
			[
				emphasisNode(0, 14, [
					textNode(1, 3, 'x '),
					unresolvedRefNode(3, 11, 'bar', 'link'),
					textNode(11, 13, ' y')
				])
			]
		]
	],
	MISSES
);

describeScanCases('without a resolver, reference forms stay literal text', [
	['full form', '[foo][bar]', [textNode(0, 10, '[foo][bar]')]],
	['collapsed form', '[foo][]', [textNode(0, 7, '[foo][]')]],
	['image form', '![foo][bar]', [textNode(0, 11, '![foo][bar]')]]
]);
