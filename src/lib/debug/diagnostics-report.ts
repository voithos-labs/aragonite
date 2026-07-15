/**
 * The attachable field report `getDiagnostics().serializeDiagnostics()` produces:
 * a fenced-markdown snapshot a consumer pastes into a bug report. Pure over its
 * inputs so the privacy pin — the document source is EXCLUDED unless the consumer
 * opts in — is unit-testable without mounting the editor.
 */

export interface DiagnosticsReportInput {
	timestamp: string;
	/** Interaction-trace tail, pre-rendered by the debug engine. */
	trace: string;
	/** Operations-log tail, pre-rendered by the debug engine. */
	opsLog: string;
	/** One-line selection summary. */
	selection: string;
	/** Raw document Markdown. Emitted ONLY when `includeSource` is true. */
	source: string;
	includeSource: boolean;
}

function fenced(title: string, body: string): string {
	return `## ${title}\n\n\`\`\`\n${body || '(empty)'}\n\`\`\``;
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
