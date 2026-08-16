import { describe, it, expect } from 'vitest';
import { buildDiagnosticsReport } from '$lib/debug/diagnostics-report';

const SECRET = 'CONFIDENTIAL-DOCUMENT-BODY';

function report(includeSource: boolean): string {
	return buildDiagnosticsReport({
		timestamp: '2026-07-15T00:00:00.000Z',
		trace: 'text-render/rebuild changed=raw',
		opsLog: 'op=split',
		selection: 'anchor=[0]@1 focus=[0]@1',
		source: SECRET,
		includeSource
	});
}

describe('buildDiagnosticsReport', () => {
	it('renders the fixed sections with the timestamp', () => {
		const out = report(false);
		expect(out).toContain('# aragonite editor diagnostics — 2026-07-15T00:00:00.000Z');
		expect(out).toContain('## Interaction trace');
		expect(out).toContain('## Operations log');
		expect(out).toContain('## Selection');
		expect(out).toContain('text-render/rebuild changed=raw');
	});

	// The privacy pin: a field report must not leak the document by default.
	it('EXCLUDES the document source unless opted in', () => {
		const out = report(false);
		expect(out).not.toContain(SECRET);
		expect(out).not.toContain('## Source');
	});

	it('includes the source only when includeSource is true', () => {
		const out = report(true);
		expect(out).toContain('## Source');
		expect(out).toContain(SECRET);
	});

	// Miss-analysis: every case fed the report bodies that were prose, so nothing drew the one
	// content a diagnostics dump most reliably carries — a document with a code fence in it.
	it('escalates a section fence past a fence run in its own body', () => {
		const out = buildDiagnosticsReport({
			timestamp: 't',
			trace: '',
			opsLog: '',
			selection: '',
			source: '```js\nconst a = 1;\n```\n',
			includeSource: true
		});
		const source = out.slice(out.indexOf('## Source'));
		expect(source).toContain('````\n```js');
		expect(source.trimEnd().endsWith('````')).toBe(true);
	});

	it('renders (empty) for a blank section body', () => {
		const out = buildDiagnosticsReport({
			timestamp: 't',
			trace: '',
			opsLog: '',
			selection: '',
			source: '',
			includeSource: false
		});
		expect(out).toContain('(empty)');
	});
});
