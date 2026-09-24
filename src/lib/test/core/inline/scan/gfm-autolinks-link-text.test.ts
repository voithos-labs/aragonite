// Miss-analysis: the one row that put a bare URL in a link's text pinned the nested autolink as
// correct, and nothing compared the shape to cmark-gfm, which leaves a link's text unlinked. The
// open-bracket rows: the image alt row pinned the editor's own reading, and no row put an address
// after a bracket that never closed (GH #422).
import {
	autolinkNode,
	describeScanCases,
	emphasisNode,
	imageNode,
	linkNode,
	resolverOf,
	textNode
} from './scan-test-helpers';

describeScanCases(
	"a link's text is never a bare autolink",
	[
		[
			'email as the whole text',
			'[foo@bar.com](u)',
			[linkNode(0, 16, [textNode(1, 12, 'foo@bar.com')], 'u')]
		],
		[
			'url as the whole text',
			'[https://x.co](u)',
			[linkNode(0, 17, [textNode(1, 13, 'https://x.co')], 'u')]
		],
		[
			'www as the whole text',
			'[www.x.co](u)',
			[linkNode(0, 13, [textNode(1, 9, 'www.x.co')], 'u')]
		],
		[
			'www after other text',
			'[see www.x.com](/u)',
			[linkNode(0, 19, [textNode(1, 14, 'see www.x.com')], '/u')]
		],
		[
			'url under emphasis inside the text',
			'[*https://x.co*](u)',
			[linkNode(0, 19, [emphasisNode(1, 15, [textNode(2, 14, 'https://x.co')])], 'u')]
		],
		[
			'full reference form',
			'[www.x.co][r]',
			[linkNode(0, 13, [textNode(1, 9, 'www.x.co')], '/r', { label: 'r' })]
		],
		[
			'shortcut reference form',
			'[foo@bar.com]',
			[linkNode(0, 13, [textNode(1, 12, 'foo@bar.com')], '/f', { label: 'foo@bar.com' })]
		],
		[
			'prose after the link still links',
			'[a](u) www.x.co',
			[
				linkNode(0, 6, [textNode(1, 2, 'a')], 'u'),
				textNode(6, 7, ' '),
				autolinkNode(7, 15, 'http://www.x.co')
			]
		],
		[
			'www in an image alt stays text',
			'![www.x.com](/u)',
			[imageNode(0, 16, [textNode(2, 11, 'www.x.com')], 'www.x.com', '/u')]
		],
		[
			'email in an image alt links',
			'![me@x.co](/u)',
			[imageNode(0, 14, [autolinkNode(2, 9, 'mailto:me@x.co')], 'me@x.co', '/u')]
		]
	],
	resolverOf({ r: { url: '/r' }, 'foo@bar.com': { url: '/f' } })
);

// cmark-gfm matches the www and url forms only where no `[` is open before them, a link's or an
// image's, closed later or not; the email form matches anywhere.
describeScanCases("an open bracket's text is never a www or url autolink", [
	['www after an unclosed bracket', '[a www.x.co', [textNode(0, 11, '[a www.x.co')]],
	['url after an unclosed bracket', '[a https://x.co', [textNode(0, 15, '[a https://x.co')]],
	[
		'email after an unclosed bracket links',
		'[a foo@bar.com',
		[textNode(0, 3, '[a '), autolinkNode(3, 14, 'mailto:foo@bar.com')]
	],
	[
		'www after a bracket that closed first links',
		'[a] www.x.co',
		[textNode(0, 4, '[a] '), autolinkNode(4, 12, 'http://www.x.co')]
	],
	[
		'www inside a bracket a link closes later',
		'[a www.x.co](u)',
		[linkNode(0, 15, [textNode(1, 11, 'a www.x.co')], 'u')]
	]
]);
