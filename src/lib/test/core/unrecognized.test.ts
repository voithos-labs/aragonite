import { describeRoundTrips } from '$lib/test/support/round-trip';

describeRoundTrips('non-GFM syntax round-trips without loss', [
	{
		name: 'footnote syntax',
		source: 'Text[^1].\n\n[^1]: Footnote content.\n'
	},
	{
		name: 'mixed supported and non-standard blocks',
		source: '# Heading\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nParagraph.\n'
	}
]);
