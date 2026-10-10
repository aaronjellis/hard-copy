# Hard Copy

Print spreadsheets the way you want them.

Hard Copy is a spreadsheet print utility that runs in your browser. Paste cells or import a CSV, TSV, or Excel file, set up the pages, choose and size the columns, style the table, add headers and footers, check a true page-by-page preview, and print or download a PDF. No server: everything runs on the device and nothing is uploaded.

Hard Copy is under construction. It shares its stack and design system with [Letter Rip](https://labs.aaronjellis.com/letter-rip/).

## Fonts

The table font comes from one of these sources:

- **Standard and bundled fonts:** work offline and need no setup. The build includes 8 bundled text families, each with regular, bold, italic, and bold italic faces.
- **Google Fonts:** a searchable list that appears only when you configure an API key.
- **Installed on this device:** fonts installed on your computer. This source requires Chrome 103 or later and shows a one-time permission prompt.

When a font has no bold or italic face, the PDF uses the closest face that exists. It never fakes a style.

To enable the Google Fonts search:

1. In Google Cloud, create a Google Fonts Developer API key.
2. Restrict the key to your site's domain with an HTTP referrer restriction.
3. Copy `.env.example` to `.env`.
4. Set `VITE_GOOGLE_FONTS_API_KEY` in `.env` to your key.
5. Run `npm run build`.

The key is embedded in the built site, so the referrer restriction is what protects it.

The interface fonts, Clash Display and Satoshi, come from Fontshare. Their license doesn't allow redistribution through a repository, so `npm install` downloads them. To fetch them again, run `npm run fonts:ui`. See [public/fonts/README.md](public/fonts/README.md).

## Develop

    npm install
    npm run dev      # local server
    npm test         # unit tests
    npm run check    # type check
    npm run build    # static site in dist/

## Deploy

`npm run build` produces `dist/`. Copy its contents to any static host or any path on an existing site. The build uses relative URLs, so it works at `/`, `/hard-copy/`, or a subdomain. The live site is at `https://labs.aaronjellis.com/hard-copy/`.

`dist/` includes about 14 MB of bundled fonts. The browser downloads a face only when the table uses it.

### SEO and sharing

To get canonical and social tags, a `Sitemap:` line in `robots.txt`, and `sitemap.xml`, set `VITE_SITE_URL` in `.env` to the full public URL (for example `https://labs.aaronjellis.com/hard-copy/`) before you run `npm run build`. When it's empty, the build omits those URL tags and writes `robots.txt` without a sitemap.

## License

Hard Copy is released under the MIT License. See [LICENSE](LICENSE). Bundled fonts, interface fonts, and libraries keep their own licenses, listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
