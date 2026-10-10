# Hard Copy

Print spreadsheets the way you want them.

Hard Copy prints spreadsheets from a browser. Paste cells or import a CSV, TSV, or Excel file, set up the pages, choose and size the columns, style the table, add headers and footers, check every page in the preview, and print or download a PDF. Built for managed Chromebooks and other locked-down computers. No server: everything runs on the device and nothing is uploaded.

Hard Copy is the sibling of [Letter Rip](https://labs.aaronjellis.com/letter-rip/), which prints envelopes, and shares its stack and design system.

## Use

1. Open the site.
2. Click **Load spreadsheet** and choose a CSV, TSV, or Excel (`.xlsx`, `.xls`) file. Or drop the file on the **Spreadsheet** bar, or click **Paste cells** and paste from any spreadsheet.
3. Set up the pages, columns, style, and headers and footers in the cards below the bar. Each card shows a one-line summary while it's collapsed.
4. Check the pages in the preview. To step through them, use the ‹ › buttons or the Left and Right arrow keys.
5. Click **Print**. The PDF opens in a new tab; print it from there. To save the PDF instead, click **Download PDF**.

Your setup and theme are remembered on this device. The spreadsheet isn't saved between sessions.

**Export setup** saves your setup to `hardcopy-setup.json`, which you can **Import** on another computer.

## Load a spreadsheet

- For a workbook with several sheets, choose the sheet from the **Sheet** list on the bar.
- To check the data, click **Edit** on the bar:
  - Turn **First row is headers** on or off.
  - For sideways sheets, turn on **Headers run down the first column**.
  - To rename a column, click its header.
  - To skip a row, clear its checkbox. **Select all** and **Clear** apply to every row.
- To remove the spreadsheet, click the X on the bar.

## Page

- **Paper:** Letter, Legal, Tabloid, A4, A3, or **Custom…**. For a custom size, enter the width and height in inches or millimeters. Each side must be 3 to 48 inches.
- **Orientation:** portrait or landscape.
- **Margins:** Narrow (0.5 in), Normal (0.75 in), Wide (1 in), or Custom. Custom margins take each side separately, in inches or millimeters.
- **Scale:**
  - **Fit to width** shrinks the columns to fit across one page. It never enlarges them.
  - **Fit to pages** fits the sheet to a number of pages wide by a number of pages tall, from 1 to 20 each.
  - **Scale %** sets the size directly, from 25% to 200%.
- **Repeat header row on every page:** prints the header row at the top of each page.
- **Gridlines:** draws a hairline around every cell, in the **Borders** color from the **Style** card. When **Borders** is **None**, no gridlines print.
- **Page order:** when the sheet is more than one page wide, prints **Down, then over** or **Over, then down**.

## Columns and rows

The **Columns** card lists the columns in print order:

- To leave a column out, clear its checkbox.
- To reorder columns, drag them, or use the up and down buttons.
- **Width:** **Auto** sizes the column to its contents. **Fixed width** sets it in inches.
- **Alignment:** **Auto** aligns numbers and dates right and text left. Or choose left, center, or right.
- **Wrap:** wraps long text onto several lines. With wrap off, a cell prints on one line and long text ends in an ellipsis.

Under **Rows**, enter a number in **Print the first N rows** to print only the top of the sheet. Leave it empty to print every row. **Include blank rows** keeps rows that are empty in every printed column.

## Style

- **Font** and **Size** for the table. See [Fonts](#fonts).
- **Header row:** bold, fill color, and text color.
- **Lead column:** bold and fill color for the first printed column. A styled lead column repeats on every page when the sheet is more than one page wide.
- **Zebra stripes:** a fill color on every other row.
- **Cell padding:** Compact, Normal, or Relaxed.
- **Borders:** Hairline or None, with a color.

## Headers and footers

The header and footer each have a left, center, and right position. Each position can show one of these:

- Title
- File name
- Sheet name
- Date
- Time
- Page N
- Page N of M
- Custom text

**Title** prints the text in the **Title** field, or the file name when the field is empty. **Size** sets the header and footer font size.

## Print from a phone or tablet

Phones and tablets show no print dialog for a PDF. There, **Print** draws the pages as images in a new window and opens your device's print screen. A long sheet goes to the share sheet instead; choose **Print** there. **Download PDF** saves the PDF on any device.

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

To regenerate the social image `public/og.png` after you edit `docs/og-source.html`, run this from the repo root: `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot="$PWD/public/og.png" --window-size=1200,630 --hide-scrollbars --allow-file-access-from-files "file://$PWD/docs/og-source.html"`.

## License

Hard Copy is released under the MIT License. See [LICENSE](LICENSE). Bundled fonts, interface fonts, and libraries keep their own licenses, listed in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
