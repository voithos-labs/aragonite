/**
 * G4.305: every container write goes through `writeContainerRaw`, so a kind's own `rebuildRaw` is
 * read there and nowhere else, and a fenced or colon shape's writer is called there alone.
 */

import { describe, it, expect } from 'vitest';
import { collectEditorSources, fileClasses, type SourceFile } from './scan-source';
import { probeFile } from './file-rule';
import { SOURCE_DIR } from './source-paths';

const HOME = 'src/lib/schema/container-writer.ts';

/** Where a shape's writer symbol is declared, beside the shape types. */
const SHAPE_TYPES = 'src/lib/core/strip-lines.ts';

/** The conformance kits check that a kind registered with its own rebuild declares a `rebuildRaw`;
 *  delete the entry when they check a plugin's shapes instead. */
const READS_REBUILD_RAW = [SOURCE_DIR.testing];

const CODE = 0;

/** `path:line` for each code position in `file` matching `pattern`. */
function hits(file: SourceFile, pattern: RegExp): string[] {
	const classes = fileClasses(file);
	return [...file.code.matchAll(pattern)]
		.filter((m) => classes[m.index] === CODE)
		.map((m) => `${file.relPath}:${file.code.slice(0, m.index).split('\n').length}`);
}

function scan(sources: SourceFile[]): { rebuildRaw: string[]; shapeWriter: string[] } {
	const rebuildRaw: string[] = [];
	const shapeWriter: string[] = [];
	for (const file of sources) {
		if (file.relPath === HOME) continue;
		if (!READS_REBUILD_RAW.some((dir) => file.relPath.startsWith(dir))) {
			rebuildRaw.push(...hits(file, /\.rebuildRaw\b/g));
		}
		if (file.relPath !== SHAPE_TYPES) shapeWriter.push(...hits(file, /\bWRITES_LINES\b/g));
	}
	return { rebuildRaw, shapeWriter };
}

describe('G4.305 a container is written through writeContainerRaw', () => {
	const report = scan(collectEditorSources());

	it('reads a kind’s rebuildRaw only in the writer', () => {
		expect(report.rebuildRaw, `call \`writeContainerRaw\` from ${HOME} instead`).toEqual([]);
	});

	it('calls a fenced or colon shape’s writer only in the writer', () => {
		expect(report.shapeWriter, `call \`writeContainerRaw\` from ${HOME} instead`).toEqual([]);
	});

	it('flags a read in code and spares comments, strings and the allowed homes', () => {
		const flagged = (code: string, relPath = 'src/lib/editor-actions/probe.ts') => {
			const found = scan([probeFile({ relPath, code })]);
			return found.rebuildRaw.length + found.shapeWriter.length > 0;
		};
		expect(flagged('descriptor.rebuildRaw?.(node);')).toBe(true);
		expect(flagged('if (d.rebuildRaw) return;')).toBe(true);
		expect(flagged('shape[WRITES_LINES](node);')).toBe(true);
		expect(flagged("// descriptor.rebuildRaw\nconst s = 'x.rebuildRaw';")).toBe(false);
		expect(flagged('descriptor.rebuildRaw?.(node);', HOME)).toBe(false);
		expect(flagged('d.rebuildRaw;', `${SOURCE_DIR.testing}kit.ts`)).toBe(false);
		expect(flagged('shape[WRITES_LINES](node);', `${SOURCE_DIR.testing}kit.ts`)).toBe(true);
	});
});
