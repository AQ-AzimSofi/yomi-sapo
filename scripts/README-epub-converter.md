# EPUB to Text with Furigana Converter

`scripts/core/epub-to-text-furigana.py` converts a Japanese EPUB to plain text with furigana (ruby annotations). It is step 1 of the book pipeline, `scripts/epub-to-book.ts`, which is the usual way to run it (see [README.md](./README.md)). Run it on its own to extract a book without rephrasing it.

## Features

- **Preserves existing furigana**: keeps every ruby tag already in the EPUB, which matters most for character names and special terms
- **Consistent readings**: a first pass collects the readings the EPUB gives names and terms, so the same word gets the same reading everywhere
- **Adds missing furigana**: uses MeCab to add furigana to kanji that have none, either to all of them (default) or, with `--filter n3`, only to kanji above N4
- **Extracts images**: saves the cover and illustrations next to the text and leaves an `[IMAGE:...]` line where each one appeared

## Installation

From the project root:

```bash
pip install -r scripts/requirements.txt
python -c "import MeCab; print('MeCab installed successfully!')"
```

See "Python Setup" in [README.md](./README.md) if MeCab fails to install.

## Usage

```bash
# Furigana on all kanji (default)
python scripts/core/epub-to-text-furigana.py path/to/book.epub --output public/bookv2-furigana

# Furigana only on N3+ kanji
python scripts/core/epub-to-text-furigana.py path/to/book.epub --filter n3 --output public/bookv2-furigana

# Every option and its default
python scripts/core/epub-to-text-furigana.py --help
```

Pass `--output` every time. Without it the script writes to `scripts/public/bookv2-furigana/`, not the `public/bookv2-furigana/` its `--help` names: the default is still computed for the folder the script lived in before it moved to `scripts/core/`. The pipeline always passes `--output`. Use `python3` where `python` is Python 2 or missing.

## Output

```
<output>/<title>/
├── <title>.txt     Title: and Author: lines, then the chapters in reading order
├── <title>.json    metadata: title, author, processing settings, image list
└── images/         illustration-000 (the cover, when found), illustration-001, ...
```

`<title>` is the EPUB's title with characters that are not allowed in file names removed. The text keeps furigana as HTML ruby tags:

```html
Title: Book Title
Author: Author Name

<ruby>第<rt>だい</rt></ruby>一<ruby>章<rt>しょう</rt></ruby>

彼は<ruby>学校<rt>がっこう</rt></ruby>へ<ruby>行<rt>い</rt></ruby>った。
```

With `--filter n3`, existing ruby is kept and only kanji outside the N4 list get new furigana:

```html
<!-- EPUB -->
彼女は<ruby>難読<rt>なんどく</rt></ruby>な文章を読んでいた。

<!-- Output -->
<ruby>彼女<rt>かのじょ</rt></ruby>は<ruby>難読<rt>なんどく</rt></ruby>な<ruby>文章<rt>ぶんしょう</rt></ruby>を読んでいた。
```

The reader parses these tags with `lib/utils/furiganaParser.ts`.

## Getting the Book Into the App

The library and the reader read book text from the database (`text_entries`), not from `public/`, which is gitignored and never deployed. Running the extractor alone does not load anything there. Either:

- run the whole pipeline, `npx tsx scripts/epub-to-book.ts`, which syncs the text to the local database through the dev server, or
- run the extractor with `--output-mode api`. It still writes the images and metadata JSON, but posts the text to `/api/admin?action=text-entries` as `bookv2-furigana/<title>` instead of writing the `.txt` file. It needs `ADMIN_API_KEY` in the environment and a running server at `API_URL` (default `http://localhost:3333`)

Illustrations reach production only through the BookImages bucket (see "Book Illustrations" in the root README).

## Troubleshooting

### "Failed to initialize MeCab"

Install MeCab and its dictionary: `pip install mecab-python3 unidic-lite`.

### "Missing required dependencies"

Install everything: `pip install -r scripts/requirements.txt`.

### "File doesn't have .epub extension"

The script asks whether to continue. Answer `y` if the file is an EPUB with another extension, `n` to stop.

### "No chapters could be extracted"

The EPUB may be corrupted, use non-standard formatting or be DRM-protected (not supported). Open it in a reader such as Calibre to check that it is valid.

### Output text looks garbled

Open the file as UTF-8.

## N4 Kanji List

`--filter n3` skips the kanji in `N4_AND_LOWER_KANJI` in `scripts/core/furigana_helper.py`, about 200 JLPT N4-and-below kanji such as 一、日、人、行、食 that intermediate learners read without help. Edit that set to change the filter.
