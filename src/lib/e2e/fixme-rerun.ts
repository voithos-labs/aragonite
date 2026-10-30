// How the shared e2e `test` treats `test.fixme`. Under `E2E_RERUN_FIXME`, which
// `scripts/release/fixme-recheck.mjs` sets, an in-test `test.fixme(condition, reason)` records its reason
// as a `fixme-rerun` annotation and lets the test run; every other form keeps Playwright's behavior.

interface FixmeHost {
	fixme: (...args: never[]) => void;
	info(): { annotations: { type: string; description?: string }[] };
}

/** The `test` to export: the same object, with `fixme` swapped only when the env asks for it. */
export function withFixmeRerun<T extends FixmeHost>(
	test: T,
	env: Record<string, string | undefined>
): T {
	if (!env.E2E_RERUN_FIXME) return test;
	const fixme = test.fixme as (...args: unknown[]) => void;
	const insideTest = () => {
		try {
			return test.info() !== undefined;
		} catch {
			return false;
		}
	};
	test.fixme = ((...args: unknown[]) => {
		if (typeof args[0] !== 'boolean' || !insideTest()) return fixme(...args);
		if (args[0])
			test.info().annotations.push({ type: 'fixme-rerun', description: String(args[1]) });
	}) as T['fixme'];
	return test;
}
