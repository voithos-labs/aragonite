<script module lang="ts">
	import { memoPlugin } from '../memo/register';
	import { MEMO_BLOCK } from '../memo/memo-kind';

	// One module-scoped plugin object shared by both editors: definitions are
	// process-global (register-once), so the memo kind is defined ONCE. The two
	// editors differ only in enablement — the per-instance policy layer over the
	// global definition (concern #1).
	const plugins = [memoPlugin()];

	// Disable the memo kind for the left editor. `__registryEnablement` is the
	// harness-only door for the enablement proof — not a public prop.
	const disableMemo = (kind: string) => kind !== MEMO_BLOCK;
</script>

<script lang="ts">
	import { Editor } from '$lib';

	// Both editors parse the SAME seed with the global grammar, so both hold a memo
	// CST node. The left editor resolves NO component for it (disabled) → the
	// raw-editable fallback (the unknown-kind rule); the right resolves MemoBlock.
	const SEED = 'Before\n\n%% memo text\n\nAfter\n';
</script>

<div class="enablement-harness aragonite-editor-theme">
	<div class="pane" data-testid="editor-disabled">
		<h2>memo disabled</h2>
		<Editor source={SEED} {plugins} __registryEnablement={disableMemo} />
	</div>
	<div class="pane" data-testid="editor-enabled">
		<h2>memo enabled</h2>
		<Editor source={SEED} {plugins} />
	</div>
</div>

<style>
	.enablement-harness {
		width: 100vw;
		height: 100vh;
		display: flex;
	}
	.pane {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-right: 1px solid var(--color-ui-muted, #ccc);
	}
	.pane h2 {
		margin: 0;
		padding: 0.4rem;
		font-size: 0.85rem;
	}
</style>
