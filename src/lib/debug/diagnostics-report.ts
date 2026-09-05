/**
 * The attachable field report `getDiagnostics().serializeDiagnostics()` produces:
 * a fenced-markdown snapshot a consumer pastes into a bug report. Pure over its
 * inputs so the privacy pin — the document source is EXCLUDED unless the consumer
 * opts in — is unit-testable without mounting the editor.
 */

import { escalatedFenceLength } from '../core/parsers/fence-syntax';

export interface DiagnosticsReportInput {
	timestamp: string;
	/** Tails pre-rendered by the debug engine. */
	trace: string;
	opsLog: string;
	selection: string;
	/** Raw document Markdown. Emitted ONLY when `includeSource` is true. */
	source: string;
	includeSource: boolean;
}

// A trace tail or a document body routinely holds a fence of its own, which would close the
// section early and hand the maintainer a malformed report.
function fenced(title: string, body: string): string {
	const text = body || '(empty)';
	const fence = '`'.repeat(escalatedFenceLength(text, '`', 3));
	return `## ${title}\n\n${fence}\n${text}\n${fence}`;
}

export function buildDiagnosticsReport(input: DiagnosticsReportInput): string {
	const sections = [
		fenced('Interaction trace', input.trace),
		fenced('Operations log', input.opsLog),
		fenced('Selection', input.selection)
	];
	// Default-excluded: a field report must not leak the document unless asked.
	if (input.includeSource) sections.push(fenced('Source', input.source));
	return `# aragonite editor diagnostics — ${input.timestamp}\n\n${sections.join('\n\n')}\n`;
}
