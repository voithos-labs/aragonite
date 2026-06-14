<script lang="ts">
	// Test-route only: throws during render to exercise BlockHost's <svelte:boundary>.
	// Never registered in production.
	throw new Error('ThrowOnRenderBlock: intentional render failure');
</script>
