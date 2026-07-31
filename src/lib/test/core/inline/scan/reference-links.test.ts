import {
	describeScanCases,
	emphasisNode,
	imageNode,
	linkNode,
	resolverOf,
	textNode,
	unresolvedRefNode
} from './scan-test-helpers';

// Reference forms (CommonMark §6.3). Precedence, label normalization and the bracketAfter
// guard follow commonmark.js 0.31.2 parseCloseBracket; resolver-returned url/title pass
// through byte-for-byte, since LRD destinations are stored raw.

const REFS = resolverOf({
	go: { url: '/go', title: 'Go now' },
	foo: { url: '/foo' },
	'my label': { url: '/ml' },
	'a\\]b': { url: '/esc' },
	raw: { url: 'a\\(b)%zzé' },
	'a ![b](u) c': { url: '/trap' }
});

describeScanCases(
	'full reference form',
	[
		[
			'resolves with url, title, and normalized label',
			'[text][go]',
			[linkNode(0, 10, [textNode(1, 5, 'text')], '/go', { title: 'Go now', label: 'go' })]
		],
		[
			'resolver url passes through byte-for-byte (no escape/percent processing)',
			'[x][raw]',
			[linkNode(0, 8, [textNode(1, 2, 'x')], 'a\\(b)%zzé', { label: 'raw' })]
		],
		[
			'label matching is case-insensitive',
			'[x][GO]',
			[linkNode(0, 7, [textNode(1, 2, 'x')], '/go', { title: 'Go now', label: 'go' })]
		],
		[
			'label whitespace collapses before matching',
			'[x][my  label]',
			[linkNode(0, 14, [textNode(1, 2, 'x')], '/ml', { label: 'my label' })]
		],
		[
			'escaped bracket inside the label resolves',
			'[text][a\\]b]',
			[linkNode(0, 12, [textNode(1, 5, 'text')], '/esc', { label: 'a\\]b' })]
		],
		[
			'full form wins over shortcut when both labels resolve',
			'[foo][go]',
			[linkNode(0, 9, [textNode(1, 4, 'foo')], '/go', { title: 'Go now', label: 'go' })]
		],
		[
			'emphasis inside the link text wraps at match time',
			'[*a* b][go]',
			[
				linkNode(0, 11, [emphasisNode(1, 4, [textNode(2, 3, 'a')]), textNode(4, 6, ' b')], '/go', {
					title: 'Go now',
					label: 'go'
				})
			]
		]
	],
	REFS
);

describeScanCases(
	'collapsed and shortcut forms',
	[
		[
			'collapsed reference uses the link text as label',
			'[foo][]',
			[linkNode(0, 7, [textNode(1, 4, 'foo')], '/foo', { label: 'foo' })]
		],
		[
			'shortcut reference',
			'[foo]',
			[linkNode(0, 5, [textNode(1, 4, 'foo')], '/foo', { label: 'foo' })]
		],
		[
			// A `(` that fails to parse as an inline tail does not suppress the shortcut:
			// per spec, `[foo](not a link)` with a definition for `foo` still links.
			'shortcut applies when a following ( fails to parse as an inline tail',
			'[foo](x',
			[linkNode(0, 5, [textNode(1, 4, 'foo')], '/foo', { label: 'foo' }), textNode(5, 7, '(x')]
		],
		[
			'shortcut applies when a following [ is not a valid label',
			'[foo][',
			[linkNode(0, 5, [textNode(1, 4, 'foo')], '/foo', { label: 'foo' }), textNode(5, 6, '[')]
		]
	],
	REFS
);

describeScanCases(
	'reference images',
	[
		[
			'full reference image with dimension hint',
			'![logo|2x3][go]',
			[
				imageNode(0, 15, [textNode(2, 10, 'logo|2x3')], 'logo', '/go', {
					title: 'Go now',
					width: 2,
					height: 3,
					label: 'go'
				})
			]
		],
		[
			'collapsed reference image',
			'![foo][]',
			[imageNode(0, 8, [textNode(2, 5, 'foo')], 'foo', '/foo', { label: 'foo' })]
		],
		[
			'shortcut reference image',
			'![foo]',
			[imageNode(0, 6, [textNode(2, 5, 'foo')], 'foo', '/foo', { label: 'foo' })]
		]
	],
	REFS
);

describeScanCases(
	'reference links interact with the bracket stack like inline links',
	[
		[
			'resolved reference link deactivates enclosing link openers',
			'[a [foo][go] b](x)',
			[
				textNode(0, 3, '[a '),
				linkNode(3, 12, [textNode(4, 7, 'foo')], '/go', { title: 'Go now', label: 'go' }),
				textNode(12, 18, ' b](x)')
			]
		],
		[
			'reference image inside a full reference link: both resolve',
			'[![foo][go]][go]',
			[
				linkNode(
					0,
					16,
					[
						imageNode(1, 11, [textNode(3, 6, 'foo')], 'foo', '/go', {
							title: 'Go now',
							label: 'go'
						})
					],
					'/go',
					{ title: 'Go now', label: 'go' }
				)
			]
		]
	],
	REFS
);

describeScanCases(
	'bracketAfter guard: a bracket inside the text blocks collapsed/shortcut lookup',
	[
		// The guard rejects the construct outright rather than looking the label up —
		// so no collapsed unresolvedReference is emitted, and `][]` falls back to text.
		[
			'collapsed form is rejected, [] rescans as literal text',
			'[a ![b](u) c][]',
			[
				textNode(0, 3, '[a '),
				imageNode(3, 10, [textNode(5, 6, 'b')], 'b', 'u'),
				textNode(10, 15, ' c][]')
			]
		],
		[
			// REFS resolves 'a ![b](u) c' — the guard must reject before lookup.
			'shortcut form is rejected even when the raw text would resolve',
			'[a ![b](u) c]',
			[
				textNode(0, 3, '[a '),
				imageNode(3, 10, [textNode(5, 6, 'b')], 'b', 'u'),
				textNode(10, 13, ' c]')
			]
		]
	],
	REFS
);

describeScanCases(
	'label length boundary (999 content chars)',
	[
		// CommonMark caps a reference label at 999 content chars — the boundary the
		// two cases straddle.
		[
			'a 1000-char label is not a label: shortcut takes over',
			'[foo][' + 'a'.repeat(1000) + ']',
			[
				linkNode(0, 5, [textNode(1, 4, 'foo')], '/foo', { label: 'foo' }),
				textNode(5, 1007, '[' + 'a'.repeat(1000) + ']')
			]
		],
		[
			'a 999-char label parses as full form and commits on miss',
			'[foo][' + 'a'.repeat(999) + ']',
			[unresolvedRefNode(0, 1006, 'a'.repeat(999), 'link')]
		]
	],
	REFS
);
