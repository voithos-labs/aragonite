// @vitest-environment node
// Miss-analysis: `containerDeclared` let `open` read less than the marker `first` wrote, so the rest
// of the marker read back as the child's text, and no row wrote the first line again to see it.
import { describe, expect, it } from 'vitest';
import { container, definePlugin } from '#lib/plugin.js';
import { check, isCheckFailure, type CheckReport } from '#lib/testing/check.js';

async function reportOf(run: Promise<CheckReport>): Promise<CheckReport> {
	return run.catch((error: unknown) => {
		if (isCheckFailure(error)) return error.report;
		throw error;
	});
}

function noted(name: string, first: (label: string) => string, rest: string) {
	const note = container({
		name: 'note',
		label: 'Note',
		sample: '@@1: one',
		insert: { none: 'a fixture of the check suite' },
		lines: {
			shape: 'indented',
			open: /^@@(\d+): ?/,
			data: (match: RegExpExecArray) => ({ label: match[1] }),
			first: ({ label }: { label: string }) => first(label),
			rest: () => rest,
			lazy: true
		}
	});
	return definePlugin({
		name,
		version: '1.0.0',
		editor: '*',
		contributes: () => ({ blocks: [note] })
	});
}

const declared = (report: CheckReport) => report.rows.find((r) => r.check === 'containerDeclared');

describe('containerDeclared over an indented shape', () => {
	it('fails a first marker its open reads short of', async () => {
		const report = await reportOf(check(noted('short-open', (label) => `@@${label}:: `, '    ')));
		expect(declared(report)).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/lines\.first gives "@@1:: " .* lines\.open doesn't read back/)
		});
	});

	it('names the rest that is no run of spaces, though no fixture can be made from it', async () => {
		const report = await reportOf(check(noted('tab-rest', (label) => `@@${label}: `, '\t')));
		expect(declared(report)).toMatchObject({
			status: 'failed',
			detail: expect.stringMatching(/lines\.rest gives "\\t", which isn't spaces only/)
		});
	});
});
