<script lang="ts">
  import type { Component, Snippet } from 'svelte';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';

  /*
   * A collapsible settings card: a native <details> whose summary shows the icon, the title, and a
   * one-line summary of the settings while collapsed. Card content uses the shared `.setup-card`
   * styles in app.css. `open` sets the initial state only; afterwards the reader decides.
   */
  let { title, icon: Icon, summary, open: initiallyOpen = true, rise = 0, children }: {
    title: string;
    icon: Component<{ size?: number; 'aria-hidden'?: boolean | 'true' | 'false' }>;
    summary: string;
    open?: boolean;
    /** Stagger index for the first-load animation. */
    rise?: number;
    children: Snippet;
  } = $props();

  const id = $props.id();
  // svelte-ignore state_referenced_locally
  let open = $state(initiallyOpen);
</script>

<details class="card setup-card rise" style="--i: {rise}" bind:open aria-labelledby="{id}-title">
  <summary>
    <Icon size={20} aria-hidden="true" />
    <span class="heading">
      <h2 id="{id}-title" class="card-title">{title}</h2>
      <span class="summary-line muted">{summary}</span>
    </span>
    <span class="chevron"><ChevronDown size={20} aria-hidden="true" /></span>
  </summary>
  <div class="card-body">
    {@render children()}
  </div>
</details>

<style>
  .card {
    min-width: 0;
    background: var(--surface);
    border: 1px solid var(--hairline);
    border-radius: var(--radius);
    box-shadow: var(--shadow-card);
    transition: box-shadow 120ms ease;
  }
  .card:hover { box-shadow: var(--shadow-card-hover); }

  summary {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 48px;
    padding: var(--pad, 20px);
    border-radius: var(--radius);
    list-style: none;
    cursor: pointer;
    user-select: none;
  }
  summary::-webkit-details-marker { display: none; }
  summary:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
  /* The icon sits on the title's line, not centered on the title and the summary together. */
  summary > :global(.lucide) { align-self: flex-start; margin-top: 3px; color: var(--muted); }
  details[open] > summary > :global(.lucide) { align-self: center; margin-top: 0; }
  .heading { display: grid; flex: 1 1 auto; min-width: 0; }
  .summary-line { font-size: 14px; line-height: 1.4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  details[open] .summary-line { display: none; }
  .chevron {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    color: var(--text-soft);
    transition: transform 160ms var(--ease), background-color 120ms ease;
  }
  summary:hover .chevron { background: var(--hover); }
  details[open] .chevron { transform: rotate(180deg); }

  /* The narrowest phones: a little more room for the title so it stays on one line. */
  @media (max-width: 359px) {
    summary { gap: 8px; }
    .chevron { width: 32px; height: 32px; }
    /* The 18px title's line is 23px tall. */
    summary > :global(.lucide) { margin-top: 2px; }
  }

  .card-body {
    display: grid;
    /* minmax(0, 1fr): a segmented row's labels never widen the card past the page. */
    grid-template-columns: minmax(0, 1fr);
    gap: 20px;
    min-width: 0;
    padding: 0 var(--pad, 20px) var(--pad, 20px);
    /* Card content can lay out by the card's width (StyleCard's borders row). */
    container: card / inline-size;
  }
</style>
