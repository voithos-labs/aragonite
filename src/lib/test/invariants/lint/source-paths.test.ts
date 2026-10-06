/**
 * The lint scans' path table names real files and directories, so a move that forgets the table
 * fails here at once instead of leaving a scan reading nothing.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { SOURCE, SOURCE_DIR } from './source-paths';

const kindOnDisk = (relPath: string): 'file' | 'directory' | 'missing' => {
	const full = path.resolve(relPath);
	if (!existsSync(full)) return 'missing';
	return statSync(full).isDirectory() ? 'directory' : 'file';
};

describe('the lint path table', () => {
	it('every file entry is a file on disk', () => {
		const wrong = Object.entries(SOURCE)
			.filter(([, relPath]) => kindOnDisk(relPath) !== 'file')
			.map(([key, relPath]) => `${key}: ${relPath} is ${kindOnDisk(relPath)}`);
		expect(wrong).toEqual([]);
	});

	it('every directory entry is a directory on disk, written with its trailing slash', () => {
		const wrong = Object.entries(SOURCE_DIR)
			.filter(([, relPath]) => !relPath.endsWith('/') || kindOnDisk(relPath) !== 'directory')
			.map(([key, relPath]) => `${key}: ${relPath} is ${kindOnDisk(relPath)}`);
		expect(wrong).toEqual([]);
	});

	// Two keys for one path drift apart the first time a move updates only one of them.
	it('no path is listed twice', () => {
		const paths = [...Object.values(SOURCE), ...Object.values(SOURCE_DIR)];
		expect(paths.filter((relPath, i) => paths.indexOf(relPath) !== i)).toEqual([]);
	});
});
