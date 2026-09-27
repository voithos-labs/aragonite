import { autolinkNode, describeScanCases, textNode } from './scan-test-helpers';

// Spec autolinks (CommonMark §6.5). `url` carries the reference's percent-encoded
// destination byte-for-byte — mdurl encode, see core/inline/scan/url.ts.

describeScanCases('uri autolinks', [
	['plain https uri', '<https://x.y>', [autolinkNode(0, 13, 'https://x.y')]],
	[
		'non-ascii destination bytes are percent-encoded',
		'<https://a.b/é>',
		[autolinkNode(0, 15, 'https://a.b/%C3%A9')]
	],
	[
		// §6.5 keeps backslashes literal — no escape processing reaches inside the span.
		'backslashes are uri content, not escapes',
		'<https://example.com/\\[\\>',
		[autolinkNode(0, 25, 'https://example.com/%5C%5B%5C')]
	],
	[
		'uppercase scheme parses as uri, not email',
		'<MAILTO:FOO@BAR.BAZ>',
		[autolinkNode(0, 20, 'MAILTO:FOO@BAR.BAZ')]
	],
	['one-char scheme is not an autolink', '<a:b>', [textNode(0, 5, '<a:b>')]],
	['two-char scheme is the minimum', '<ab:c>', [autolinkNode(0, 6, 'ab:c')]],
	[
		'scheme may contain +, -, and . after the first letter',
		'<a+b-c.d://x>',
		[autolinkNode(0, 13, 'a+b-c.d://x')]
	],
	[
		'32-char scheme is the maximum',
		'<' + 'a'.repeat(32) + ':x>',
		[autolinkNode(0, 36, 'a'.repeat(32) + ':x')]
	],
	[
		'33-char scheme is not an autolink',
		'<' + 'a'.repeat(33) + ':x>',
		[textNode(0, 37, '<' + 'a'.repeat(33) + ':x>')]
	],
	['space in the body kills the uri form', '<https://a b>', [textNode(0, 13, '<https://a b>')]]
]);

describeScanCases('email autolinks', [
	['plain email gets mailto:', '<a@b.c>', [autolinkNode(0, 7, 'mailto:a@b.c')]],
	[
		'local-part specials pass through',
		'<a.b+c_d@e-f.gh>',
		[autolinkNode(0, 16, 'mailto:a.b+c_d@e-f.gh')]
	],
	[
		'single-segment domain is valid per the spec regex',
		'<a@b>',
		[autolinkNode(0, 5, 'mailto:a@b')]
	],
	['domain segment ending in dash is rejected', '<a@b-.c>', [textNode(0, 8, '<a@b-.c>')]]
]);

describeScanCases('angle forms that fail both grammars stay literal', [
	['space in the local part', '<foo @bar.com>', [textNode(0, 14, '<foo @bar.com>')]],
	['empty local part', '<@bar.com>', [textNode(0, 10, '<@bar.com>')]],
	['empty angle pair', '<>', [textNode(0, 2, '<>')]],
	['trailing dot in the domain', '<foo@bar.>', [textNode(0, 10, '<foo@bar.>')]],
	['final domain segment ending in dash', '<a@b.c->', [textNode(0, 8, '<a@b.c->')]]
]);

describeScanCases('autolinks win the `<` dispatch over brackets', [
	[
		// The autolink absorbs `](uri)` into its destination, so the bracket never
		// closes and `[foo` stays literal.
		'autolink absorbs a would-be link tail',
		'[foo<https://example.com/?search=](uri)>',
		[textNode(0, 4, '[foo'), autolinkNode(4, 40, 'https://example.com/?search=%5D(uri)')]
	]
]);
