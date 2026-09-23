// Miss-analysis: the one row that put a bare URL in a link's text pinned the nested autolink as
// correct, and nothing compared the shape to cmark-gfm, which leaves a link's text unlinked.
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
			// The editor's reading: an alt is not a link, so a URL there scans as one. cmark-gfm links
			// only the email form inside an alt, not www or url; that gap is tracked separately.
			'image alt keeps its autolink',
			'![www.x.com](/u)',
			[imageNode(0, 16, [autolinkNode(2, 11, 'http://www.x.com')], 'www.x.com', '/u')]
		]
	],
	resolverOf({ r: { url: '/r' }, 'foo@bar.com': { url: '/f' } })
);
