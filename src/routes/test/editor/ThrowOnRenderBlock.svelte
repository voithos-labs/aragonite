<script lang="ts">
	// Test-route only, never registered in production: exercises BlockHost's <svelte:boundary>.
	throw new Error('ThrowOnRenderBlock: intentional render failure');
</script>
