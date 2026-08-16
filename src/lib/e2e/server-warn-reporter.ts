import type { FullResult, Reporter, TestCase } from '@playwright/test/reporter';

/**
 * Fails the run when the dev server's OWN console carries the `[aragonite:` sentinel — a guard
 * that fired during SSR, which no page-side watcher can see because it happened before the
 * browser existed. Limitation: with `reuseExistingServer`, a server Playwright did not launch
 * has no stream to read, so the gate binds runs that start their own server (CI always does).
 * The sentinel's taxonomy is `docs/contributing/warnings.md`.
 */

const SENTINEL = '[aragonite:';

class ServerWarnReporter implements Reporter {
	private readonly fires: string[] = [];

	onStdOut(chunk: string | Buffer, test?: TestCase): void {
		this.collect(chunk, test);
	}

	onStdErr(chunk: string | Buffer, test?: TestCase): void {
		this.collect(chunk, test);
	}

	async onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined> {
		if (this.fires.length === 0) return undefined;
		console.error(
			`\n${this.fires.length} dev-warning line(s) reached the run from the server process:\n` +
				this.fires.join('\n')
		);
		// Only over a green run: a failure already has its own cause and status to report.
		return result.status === 'passed' ? { status: 'failed' } : undefined;
	}

	/** Output with a `test` is a spec's own, which already fails through that spec. */
	private collect(chunk: string | Buffer, test: TestCase | undefined): void {
		if (test) return;
		for (const line of chunk.toString().split('\n')) {
			if (line.includes(SENTINEL)) this.fires.push(line.trimEnd());
		}
	}
}

export default ServerWarnReporter;
