import { describe, it, expect, beforeAll } from 'vitest';
import { installPlugins, parse } from '$lib';
import { admonitionsPlugin, convertGithubAlerts } from '$lib/plugins/admonitions';
import { convertAlertBlockquoteRaw } from '$lib/plugins/admonitions/gh-alert';
import { convertGithubAlertsInDocument } from '$lib/plugins/admonitions/convert-document';

beforeAll(() => {
	installPlugins([admonitionsPlugin()]);
});

/** The single-blockquote core, fed the extent the parser decided for the alert. */
function convertedAlertRegion(source: string): string {
	const alert = parse(source).children.find((child) => child.kind === 'githubAlert');
	if (!alert) throw new Error(`fixture parses to no githubAlert: ${JSON.stringify(source)}`);
	return convertAlertBlockquoteRaw(alert.raw)!;
}

// Both converters take their extent from `blockquoteExtent` — one handed the
// extent the parser decided, one running that same scanner over a line window —
// so CommonMark §5.1 lazy continuation lands identically on both. The last two
// rows are the shapes that forked while the stream scanner used a line regex:
// only a stateful extent absorbs a lazy line while a paragraph is open, and only
// a stateful extent stops claiming once a body line has closed it.
const AGREEING_SOURCES: [string, string][] = [
	['plain quoted body', '> [!NOTE]\n> a\n> b\n'],
	['tab-indented continuation line', '> [!NOTE]\n\t> body\n'],
	['4-space-indented continuation line', '> [!NOTE]\n> in\n    > out\n'],
	['indented-code line before the marker', '    > x\n> [!NOTE]\n> body\n'],
	['blank line ending the quote', '> [!NOTE]\n> a\n\nafter\n'],
	['body line reproducing the emitted fence', '> [!NOTE]\n> :::\n> more\n'],
	['no trailing newline', '> [!NOTE]\n> a'],
	['two alerts in one document', '> [!NOTE]\n> a\n\n> [!TIP]\n> b\n'],
	['CRLF endings', '> [!NOTE]\r\n> a\r\n'],
	['mixed line endings', '> [!NOTE]\r\n> a\n'],
	['plain lazy line inside the alert', '> [!NOTE]\n> a\nlazy\n'],
	['over-indented quote line after the paragraph closed', '> [!NOTE]\n> - item\n    > b\n']
];

describe('every alert converter agrees on the same source', () => {
	it.each(AGREEING_SOURCES)('%s', (_label, source) => {
		const stream = convertGithubAlerts(source).converted;
		expect(stream).toBe(convertGithubAlertsInDocument(source).converted);
		expect(stream).toContain(convertedAlertRegion(source));
	});
});

describe('the alert extent is the parser’s, byte for byte', () => {
	it('keeps a lazy line inside the alert', () => {
		const converted = convertGithubAlerts('> [!NOTE]\n> a\nlazy\n').converted;
		expect(converted).toBe(':::note\na\nlazy\n:::\n');
	});

	it('leaves an over-indented quote line outside once the paragraph has closed', () => {
		const converted = convertGithubAlerts('> [!NOTE]\n> - item\n    > b\n').converted;
		expect(converted).toBe(':::note\n- item\n:::\n    > b\n');
	});

	it('emits CRLF endings on the opener, body and synthesized closer', () => {
		expect(convertGithubAlerts('> [!NOTE]\r\n> a\r\n').converted).toBe(':::note\r\na\r\n:::\r\n');
		expect(convertAlertBlockquoteRaw('> [!NOTE]\r\n> a\r\n')).toBe(':::note\r\na\r\n:::\r\n');
	});

	it('gives each emitted line the ending of the source line it replaces', () => {
		// A document-level ending would emit one ending throughout and still pass
		// every uniform-ending fixture; only a mixed source discriminates.
		expect(convertAlertBlockquoteRaw('> [!NOTE]\r\n> a\n')).toBe(':::note\r\na\n:::\n');
		expect(convertAlertBlockquoteRaw('> [!NOTE]\n> a\r\n')).toBe(':::note\na\r\n:::\r\n');
	});
});
