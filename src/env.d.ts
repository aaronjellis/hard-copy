interface ImportMetaEnv {
  /** Google Fonts developer API key. Empty or unset hides the Google Fonts tier. */
  readonly VITE_GOOGLE_FONTS_API_KEY: string;
  /** Full public URL of the deployed app (for example https://example.com/hard-copy/). Empty omits canonical and social URL tags. */
  readonly VITE_SITE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
