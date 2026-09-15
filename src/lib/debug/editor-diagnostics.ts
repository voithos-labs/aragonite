/**
 * The `getDiagnostics()` door: the interaction-trace switches and the fenced field report
 * (`diagnostics-report.ts`). The document source is excluded unless the consumer opts in.
 */

import type { EditorDiagnostics } from '../editor-props';
import type { EditorSelection } from '../selection/primitives';
import { buildDiagnosticsReport } from './diagnostics-report';
import { dumpInteractionTrace, dumpOperationsLog } from './inspect';
import {
	disableInteractionTrace,
	enableInteractionTrace,
	interactionTraceSnapshot,
	isInteractionTraceEnabled
} from './interaction-trace';
import type { OperationsLog } from './operations-log';

export interface EditorDiagnosticsDeps {
	/** The public snapshot, so it covers single-block carets the cross-block state never holds. */
	getSelection(): EditorSelection | null;
	getSource(): string;
	operationsLog: OperationsLog;
}

export function createEditorDiagnostics(deps: EditorDiagnosticsDeps): EditorDiagnostics {
	function selectionSummary(): string {
		const sel = deps.getSelection();
		if (!sel) return '(no selection)';
		const fmt = (p: { path: number[]; offset: number }) => `[${p.path.join(',')}]@${p.offset}`;
		return `anchor=${fmt(sel.anchor)} focus=${fmt(sel.focus)}`;
	}

	return {
		enableTrace: enableInteractionTrace,
		disableTrace: disableInteractionTrace,
		isTraceEnabled: isInteractionTraceEnabled,
		traceSnapshot: interactionTraceSnapshot,
		serializeDiagnostics: (opts) => {
			const includeSource = opts?.includeSource ?? false;
			return buildDiagnosticsReport({
				timestamp: new Date().toISOString(),
				trace: dumpInteractionTrace(interactionTraceSnapshot()),
				opsLog: dumpOperationsLog(deps.operationsLog),
				selection: selectionSummary(),
				source: includeSource ? deps.getSource() : '',
				includeSource
			});
		}
	};
}
