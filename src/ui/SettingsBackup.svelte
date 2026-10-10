<script lang="ts">
  import { serializeProfile, parseProfile, type Profile } from '../lib/store/profile';
  import { errorMessage } from '../lib/errors';
  import Upload from '@lucide/svelte/icons/upload';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';

  let { profile, onimport }: { profile: Profile; onimport: (p: Profile) => void } = $props();
  let error = $state('');
  let fileInput = $state<HTMLInputElement>();

  function exportSettings() {
    const blob = new Blob([serializeProfile(profile)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'hardcopy-setup.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importSettings(e: Event) {
    error = '';
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const parsed = parseProfile(await file.text());
      if (confirm('Replace your current setup with the one in this file?')) onimport(parsed);
    } catch (err) {
      error = errorMessage(err);
    } finally {
      if (fileInput) fileInput.value = '';
    }
  }
</script>

<span class="backup">
  <button type="button" onclick={exportSettings}><Upload size={18} aria-hidden="true" />Export setup</button>
  <button type="button" onclick={() => fileInput?.click()}><FolderOpen size={18} aria-hidden="true" />Import</button>
  <input bind:this={fileInput} type="file" accept="application/json,.json" hidden onchange={importSettings} />
  {#if error}<span class="error status-line" role="alert"><CircleAlert size={18} aria-hidden="true" />{error}</span>{/if}
</span>

<style>
  .backup { display: inline-flex; gap: 8px; align-items: center; flex-wrap: wrap; }
</style>
