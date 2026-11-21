# Scripts Directory

Offline tools for preparing books, narration and the database. None of them run in the deployed app: `next.config.ts` keeps `scripts/` out of the bundle, and `npm run lint` skips it. `npm run typecheck:scripts` type-checks it, and CI runs that on every pull request. Run them from the project root, TypeScript with `npx tsx` and Python with Python 3.12 and MeCab.

## Contents

| Path | What it does |
|------|--------------|
| `epub-to-book.ts` | The book pipeline, see [Book Pipeline](#book-pipeline-epub-to-bookts) |
| `core/epub-to-text-furigana.py` | Pipeline step 1: EPUB to text with furigana, plus the images and a metadata JSON. It also runs on its own, see [README-epub-converter.md](./README-epub-converter.md) |
| `core/extract-ruby-smart.py` | Pipeline step 2: the ruby registry (vocabulary index). It takes no arguments: it reads every `.epub` in `temp/` and writes `ruby-registry.json` into the matching book folder, so the pipeline copies the EPUB there first |
| `core/add-furigana-to-text.py` | Pipeline step 5: furigana for the rephrased text |
| `core/furigana_helper.py` | MeCab furigana generation shared by the three scripts above |
| `utils/claude-rephrase.ts`, `prompts/claude-rephrase.md` | The Claude rephraser: runs `claude -p` with the prompt file as its system prompt |
| `utils/rephrase-output.ts` | Parses a Gemini reply and aligns it with the source chunk |
| `ocr/ocr-pages.ts` | OCRs a folder of page images into text with Gemini, for books with no EPUB (usage in the file header) |
| `kindle/page-turner.ts` | Turns Kindle Cloud Reader pages and saves screenshots, see [kindle/README.md](./kindle/README.md) |
| `covers/fetch-covers.py` | Collects book covers for the BookCovers bucket, see "Book Covers" in the root README |
| `audio/` | Audiobook narration, see [Audiobook Narration](#audiobook-narration-audio) |
| `db/` | Local schema, local and production sync, narration loading, stored text cleanup, see [db/README.md](./db/README.md) |
| `auth/generate-password-hash.ts` | Prints a bcrypt hash of a password: `npx tsx scripts/auth/generate-password-hash.ts <password>`. `AUTH_PASSWORD_HASH` takes that hash base64-encoded, since `lib/auth/password.ts` decodes it |
| `dev-with-sync.ts` | What `npm run dev` runs: starts the database container and syncs local with production when it starts and when it stops |
| `requirements.txt` | Python dependencies |

## Book Pipeline (`epub-to-book.ts`)

```bash
npx tsx scripts/epub-to-book.ts "path/to/book.epub"
npx tsx scripts/epub-to-book.ts --help    # every listed option and its default
```

Steps:

1. Extract the text, images and metadata from the EPUB into `public/bookv2-furigana/<book>/` (`core/epub-to-text-furigana.py`).
2. Build `ruby-registry.json` from the EPUB's ruby (`core/extract-ruby-smart.py`).
3. Upload `images/` and the metadata JSON to the BookImages bucket when `BOOK_IMAGES_BUCKET` is set in `.env.local` (see "Book Illustrations" in the root README).
4. Rephrase the text chunk by chunk.
5. Add furigana to each rephrased chunk (`core/add-furigana-to-text.py`) and append it to `<book>-rephrase-furigana.txt`, the text the reader shows.
6. After each chunk, call `PUT /api/text-entries` on the local dev server, which copies that file into the local database, so the book can be read while it is still being processed.

```
public/bookv2-furigana/<book>/
├── <book>.txt                       extracted text with furigana
├── <book>.json                      metadata, including the image list
├── images/                          illustrations
├── ruby-registry.json               vocabulary index
├── <book>-rephrase.txt              rephrase before furigana
├── <book>-rephrase-furigana.txt     rephrase with furigana (synced to the database)
└── <book>-rephrase-progress.json    resume state
```

`public/bookv2-furigana/` is gitignored and never deployed. The app reads book text from the database and illustrations from the BookImages bucket.

### Rephrasing

- **Claude** (the default): a `--model` that does not start with `gemini`, such as `sonnet` or `opus`, runs `claude -p` on the Claude subscription with `prompts/claude-rephrase.md` as the system prompt. Chunks run back to back with no delay. When a call fails (usage limit, sign-in), the run stops and that chunk stays unfinished.
- **Gemini**: a `gemini-*` model sends each chunk to the Gemini API. It spreads chunks over every free key named `GEMINI_API_KEY`, `GEMINI_API_KEY2`, `GEMINI_API_KEY3` and so on (the key pool `ocr/ocr-pages.ts` also uses). A free key out of daily quota for the model is set aside for the rest of the run; once none is left, `GEMINI_API_KEY_PAID` takes over on the same model. Only when that is missing or fails too does it fall back to other Gemini models. Between chunks it waits `--delay` seconds divided by the number of free keys. A chunk that still fails keeps its original lines as their own rephrase.

### Resuming

Progress is saved in `<book>-rephrase-progress.json`. Run the same command again to continue from the first unfinished chunk; a resumed run keeps the model the book started with. The script refuses to resume when the source text has changed since. `--reset` starts over and first moves the earlier `-rephrase.txt` and `-rephrase-furigana.txt` aside as `.bak` files.

### Text That Is Not an EPUB

For OCR output or a corrected source text, put the text at `public/bookv2-furigana/<book>/<book>.txt` and pass the folder with `--skip-extract`. Steps 1 and 2 are skipped, and the folder name is the book name:

```bash
npx tsx scripts/epub-to-book.ts "public/bookv2-furigana/<book>" --skip-extract
```

### Before a Run

- Start the local database and the dev server on port 3333 (`npm run db:start`, then `npm run dev` or `npm run dev:nosync`). `--api-url <url>` points step 6 at another server. Without the dev server the files are still written, and each chunk logs a failed database sync
- Install the Python dependencies (see [Python Setup](#python-setup)) into the Python the pipeline calls: the `PYTHON` environment variable if set, else `.venv` or `venv` in the project root, else `py -3` on Windows and `python3` elsewhere. The pipeline stops before step 1 when that Python cannot import MeCab
- Claude rephrasing needs the `claude` CLI signed in; Gemini rephrasing needs at least one `GEMINI_API_KEY<n>` in `.env.local`, or `GEMINI_API_KEY_PAID`

`--help` does not list `--skip-extract` or `--api-url`. It lists `--skip-images`, which has no effect: the extractor always writes the images.

### After a Run

The finished book is in the local database only. `npm run db:sync` and its push option copy it to production, as does the sync `npm run dev` runs when it stops. A new book also needs a cover (see "Book Covers" in the root README).

## Audiobook Narration (`audio/`)

Lets the reader's play button use a real narration instead of Google TTS. Needs the
recording plus a transcript of it — not the ebook text, it must match what is spoken.

```bash
# 1. Align transcript to audio -> .srt (for eyeballing) + .timings.json
python scripts/audio/align-transcript.py "book.m4b" "book.txt"

# 2. Map those cues onto reader units -> a build artifact (cue positions only)
npx tsx scripts/audio/build-narration.ts \
  --timings "book.timings.json" \
  --text "public/bookv2-furigana/<book>/<book>.txt" \
  --out "temp/<book>.narration.json"

# 3. Re-encode for the browser, then upload to the private narration bucket
ffmpeg -i "book.m4b" -map 0:a:0 -c:a aac -b:a 40k -ac 1 -ar 22050 \
  -movflags +faststart -map_metadata -1 "temp/<book>.m4a"
aws s3 cp "temp/<book>.m4a" "s3://$BUCKET/<book>.m4a" --region ap-northeast-1

# 4. Pair the cues with the S3 key in the database (the react-server condition lets
#    lib/db/connection.ts, which is server-only, load outside Next.js)
npx tsx --conditions=react-server scripts/db/sync-narration.ts \
  --manifest "temp/<book>.narration.json" \
  --audio-key "<book>.m4a" \
  --directory "bookv2-furigana" \
  --file-name "<book>"
```

The aligner uses no ASR. Container chapter marks are exact anchors, ffmpeg
`silencedetect` supplies candidate boundaries, and MeCab mora counts predict
relative duration within a chapter; a DP then picks the boundaries chapter by
chapter. It prints a mora/s spread — a tight p05..p95 means a good alignment.
It refuses to write anything when a chapter falls back to proportional timings
or a chapter title matches too weakly, since both produce plausible-looking cues
that land mid-speech.

Notes:

- Nothing here goes in `public/`. Book assets under `public/bookv2-furigana/` are
  gitignored and CI deploys from a plain checkout, so a file placed there never
  reaches production; the repo is also public, so a recording's location must not
  be committed. Cues live in the `narration` table and the audio lives in a private
  S3 bucket, which `GET /api/narration` pairs into a short-lived presigned URL
- That route requires a session, so the guest preview never receives a recording
- `--text` must be the same revision that was synced to `text_entries`. The reader
  builds its units from Postgres, and cues are positional — if the two have drifted
  by a paragraph, every later line plays the wrong audio. `unitCount` lets the
  reader reject text that has grown, but shorter text is accepted as a prefix
  (that is how the guest preview arrives), so a same-length edit or a deleted
  paragraph both slip through. Rebuild whenever you re-process a book
- Requires `ffmpeg` and `ffprobe` on PATH, and the container must have chapter marks
- Manifest cue indices are `PlayableUnit.globalIndex`; `null` falls back to TTS
- Rephrased text has no recording, so `sub` playback stays on TTS

## Kindle Page Turner (`kindle/`)

Turns Kindle Cloud Reader pages on a timer and can save a screenshot of each page.
See [kindle/README.md](./kindle/README.md).

## Python Setup

From the project root:

```bash
pip install -r scripts/requirements.txt
python -c "import MeCab; print('MeCab installed successfully!')"
```

This installs EPUB and HTML parsing (`ebooklib`, `beautifulsoup4`, `lxml`), MeCab with its dictionary (`mecab-python3`, `unidic-lite`) and the cover script's `requests` and `Pillow`. A virtual environment also works for running the Python scripts on their own; `venv/` is gitignored.

If MeCab fails to install, install the system package first, then retry `pip install mecab-python3 unidic-lite`:

```bash
brew install mecab                                              # macOS
sudo apt-get install mecab libmecab-dev mecab-ipadic-utf8       # Ubuntu/Debian
```
