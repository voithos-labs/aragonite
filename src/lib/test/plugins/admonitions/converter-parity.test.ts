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

// The indent cap landed on the stream scanner's body-scan gate as well as on the
// strip, but a cap means the opposite thing at each: the strip declines and keeps
// the line, the scan STOPS and ejects the rest of the alert. `> [!NOTE]\n\t> body\n`
// converted to `":::note\n:::\n\t> body\n"` — an empty callout — where the other two
// converters produced `":::note\n\t> body\n:::\n"`.
const AGREEING_SOURCES: [string, string][] = [
	['plain quoted body', '> [!NOTE]\n> a\n> b\n'],
	['tab-indented continuation line', '> [!NOTE]\n\t> body\n'],
	['4-space-indented continuation line', '> [!NOTE]\n> in\n    > out\n'],
	['indented-code line before the marker', '    > x\n> [!NOTE]\n> body\n'],
	['blank line ending the quote', '> [!NOTE]\n> a\n\nafter\n'],
	['body line reproducing the emitted fence', '> [!NOTE]\n> :::\n> more\n'],
	['no trailing newline', '> [!NOTE]\n> a'],
	['two alerts in one document', '> [!NOTE]\n> a\n\n> [!TIP]\n> b\n']
];

describe('every alert converter agrees on the same source', () => {
	it.each(AGREEING_SOURCES)('%s', (_label, source) => {
		const stream = convertGithubAlerts(source).converted;
		expect(stream).toBe(convertGithubAlertsInDocument(source).converted);
		expect(stream).toContain(convertedAlertRegion(source));
	});
});

// The stream scanner decides its extent one line at a time; the parser's is
// stateful — CommonMark §5.1 absorbs a lazy line only while a paragraph is open —
// so no line test can make them equal. These two inputs fork by construction and
// are pinned so the fork stays visible. Consolidating both converters onto one
// extent authority is what deletes this block.
describe('the stream scanner does not model lazy continuation (known fork)', () => {
	it('ejects a plain lazy line the parser keeps inside the alert', () => {
		const source = '> [!NOTE]\n> a\nlazy\n';
		expect(convertGithubAlerts(source).converted).toBe(':::note\na\n:::\nlazy\n');
		expect(convertGithubAlertsInDocument(source).converted).toBe(':::note\na\nlazy\n:::\n');
	});

	it('claims an over-indented quote line after a body line that closed the paragraph', () => {
		const source = '> [!NOTE]\n> - item\n    > b\n';
		expect(convertGithubAlerts(source).converted).toBe(':::note\n- item\n    > b\n:::\n');
		expect(convertGithubAlertsInDocument(source).converted).toBe(':::note\n- item\n:::\n    > b\n');
	});
});
