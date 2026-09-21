import { describe, it, expect } from 'vitest';
import { createEditorDiagnostics } from '$lib/debug/editor-diagnostics';
import { createOperationsLog } from '$lib/debug/operations-log';

// Miss-analysis: the report builder is tested as a pure function, but the entry point feeding
// it (which selection line, whether the source is read at all) was reachable only through a
// mounted editor.

function diagnostics(selection: { path: number[]; offset: number } | null) {
	let sourceReads = 0;
	const log = createOperationsLog();
	log.record({ op: 'split', path: [0], detail: {} });
	const door = createEditorDiagnostics({
		getSelection: () => selection && { anchor: selection, focus: selection },
		getSource: () => {
			sourceReads++;
			return 'SECRET';
		},
		operationsLog: log
	});
	return { door, reads: () => sourceReads };
}

describe('createEditorDiagnostics', () => {
	it('summarizes the public selection snapshot, or its absence', () => {
		expect(diagnostics({ path: [0, 2], offset: 3 }).door.serializeDiagnostics()).toContain(
			'anchor=[0,2]@3 focus=[0,2]@3'
		);
		expect(diagnostics(null).door.serializeDiagnostics()).toContain('(no selection)');
	});

	it('never reads the source unless asked, and includes it when it is', () => {
		const d = diagnostics(null);
		expect(d.door.serializeDiagnostics()).not.toContain('SECRET');
		expect(d.reads()).toBe(0);
		expect(d.door.serializeDiagnostics({ includeSource: true })).toContain('SECRET');
	});

	it('carries the operations log tail', () => {
		expect(diagnostics(null).door.serializeDiagnostics()).toContain('split');
	});
});
