# Bundled fonts

Each folder holds one family's font files and its license (`OFL.txt`). The font files are the unmodified static TTF files that the [Google Fonts Developer API](https://developers.google.com/fonts/docs/developer_api) serves. They're saved byte for byte, with no instancing, subsetting, renaming, or re-saving. The license files come from the [google/fonts](https://github.com/google/fonts) repository.

## Families

All 8 families are licensed under the SIL Open Font License 1.1. Each has Regular, Bold, Italic, and BoldItalic files. They're text faces chosen for legible tables at small sizes.

| id | Family | Files | License | Source |
| --- | --- | --- | --- | --- |
| noto-sans | Noto Sans | `NotoSans-{Regular,Bold,Italic,BoldItalic}.ttf` | OFL 1.1 | [Google Fonts](https://fonts.google.com/specimen/Noto+Sans), [license](https://github.com/google/fonts/blob/main/ofl/notosans/OFL.txt) |
| noto-serif | Noto Serif | `NotoSerif-{Regular,Bold,Italic,BoldItalic}.ttf` | OFL 1.1 | [Google Fonts](https://fonts.google.com/specimen/Noto+Serif), [license](https://github.com/google/fonts/blob/main/ofl/notoserif/OFL.txt) |
| open-sans | Open Sans | `OpenSans-{Regular,Bold,Italic,BoldItalic}.ttf` | OFL 1.1 | [Google Fonts](https://fonts.google.com/specimen/Open+Sans), [license](https://github.com/google/fonts/blob/main/ofl/opensans/OFL.txt) |
| lato | Lato | `Lato-{Regular,Bold,Italic,BoldItalic}.ttf` | OFL 1.1, RFN "Lato" | [Google Fonts](https://fonts.google.com/specimen/Lato), [license](https://github.com/google/fonts/blob/main/ofl/lato/OFL.txt) |
| roboto | Roboto | `Roboto-{Regular,Bold,Italic,BoldItalic}.ttf` | OFL 1.1 | [Google Fonts](https://fonts.google.com/specimen/Roboto), [license](https://github.com/google/fonts/blob/main/ofl/roboto/OFL.txt) |
| source-sans-3 | Source Sans 3 | `SourceSans3-{Regular,Bold,Italic,BoldItalic}.ttf` | OFL 1.1, RFN "Source" | [Google Fonts](https://fonts.google.com/specimen/Source+Sans+3), [license](https://github.com/google/fonts/blob/main/ofl/sourcesans3/OFL.txt) |
| merriweather | Merriweather | `Merriweather-{Regular,Bold,Italic,BoldItalic}.ttf` | OFL 1.1, RFN "Merriweather" | [Google Fonts](https://fonts.google.com/specimen/Merriweather), [license](https://github.com/google/fonts/blob/main/ofl/merriweather/OFL.txt) |
| lora | Lora | `Lora-{Regular,Bold,Italic,BoldItalic}.ttf` | OFL 1.1, RFN "Lora" | [Google Fonts](https://fonts.google.com/specimen/Lora), [license](https://github.com/google/fonts/blob/main/ofl/lora/OFL.txt) |

## Reserved Font Names

Four families declare a Reserved Font Name (RFN in the table). Under OFL section 3, a Modified Version can't use a Reserved Font Name. These files are unmodified copies of the copyright holders' fonts as Google distributes them, so they keep their original names legitimately.

To keep it that way, don't edit, instance, subset, or re-save these files. The app pads glyphs at run time when a font needs it for PDF subsetting. That happens in memory, in the user's browser, and never changes the files here.

## How the bundled fonts get here

`scripts/fetch-bundled-fonts.mjs` downloads the files. It reads `VITE_GOOGLE_FONTS_API_KEY` from `.env`, looks up each family in the Google Fonts Developer API, and saves the `regular`, `700`, `italic`, and `700italic` files under the names in `src/lib/fonts/catalog.ts`. It also downloads each family's `OFL.txt`. It checks that every font file is an sfnt larger than 50 KB, then prints a table of what it saved.

The script skips files that already exist. To delete and download every file again, pass `--force`:

    npm run fonts:bundled -- --force

The API key is restricted to HTTP referrers, so the script sends a `http://localhost:5174/` referrer that the key allows.

Lato is the exception: its four faces are the unmodified static files from the `google/fonts` repository (`ofl/lato/`), because the API serves an older build with far fewer characters. All files are unmodified, so Reserved Font Names are retained legitimately.

## UI typefaces

`ui/` holds the typefaces for the app's own interface. They're never embedded in printed PDFs, aren't part of the bundled font catalog, and must never be offered as selectable fonts: the license forbids making them available for other people to set their own content in.

| Folder | Family | File name | License | Source |
| --- | --- | --- | --- | --- |
| ui/clash-display | Clash Display (variable, wght 200–700) | `ClashDisplay-Variable.woff2` | ITF Free Font License 2.0 (`FFL.txt`) | https://www.fontshare.com/fonts/clash-display |
| ui/satoshi | Satoshi (variable, wght 300–900) | `Satoshi-Variable.woff2` | ITF Free Font License 2.0 (`FFL.txt`) | https://www.fontshare.com/fonts/satoshi |

Both files are the unmodified WOFF2 files from the Fontshare download. The license allows self-hosting them for this app. It doesn't allow modifying, subsetting, or converting them, or redistributing them through a public repository or download service.

Clash Display sets the wordmark and the card titles. Satoshi sets everything else.

### How the UI fonts get here

The Fontshare license allows self-hosting on your own site but not redistribution through a repository, so the `.woff2` files are gitignored. `npm install` runs `scripts/fetch-ui-fonts.mjs`, which downloads them from Fontshare into this folder. To fetch them again by hand:

    npm run fonts:ui
