# Scripts Directory

Offline tools for preparing books, narration and the database. None of them run in the deployed app: `next.config.ts` keeps `scripts/` out of the bundle, and `npm run lint` skips it. `npm run typecheck:scripts` type-checks it, and CI runs that on every pull request. Run them from the project root, TypeScript with `npx tsx` and Python with Python 3.12 and MeCab. `epub-to-book.ts`, `ocr/ocr-pages.ts` and `audio/build-narration.ts` define their flags in one schema each (`shared/cliSchema.ts`), and `--help` prints them with their defaults; this README does not repeat the defaults.

## Contents

| Path | What it does |
|------|--------------|
| `epub-to-book.ts`, `pipeline/` | The book pipeline, see [Book Pipeline](#book-pipeline-epub-to-bookts) |
| `core/epub-to-text-furigana.py` | The pipeline's EPUB source: EPUB to text with furigana, plus the images and a metadata JSON. It also runs on its own, see [README-epub-converter.md](./README-epub-converter.md) |
| `core/extract-ruby-smart.py` | Pipeline step 1: the ruby registry (vocabulary index). `extract-ruby-smart.py <book.epub> --out <book folder>/ruby-registry.json`; the folder name becomes the registry's `bookTitle`, and it exits non-zero without writing when the EPUB cannot be read |
| `core/add-furigana-to-text.py` | Furigana for the rephrased text (pipeline step 3) and for OCR text |
| `core/furigana_helper.py` | MeCab furigana generation shared by the three scripts above |
| `utils/claude-rephrase.ts`, `prompts/claude-rephrase.md` | The Claude rephraser: runs `claude -p` with the prompt file as its system prompt |
| `utils/rephrase-output.ts` | Parses a Gemini reply and aligns it with the source chunk |
| `ocr/ocr-pages.ts` | OCRs a folder of page images into text with Gemini, for books with no EPUB (`--help` lists its options and their defaults) |
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
npx tsx scripts/epub-to-book.ts --help    # every option and its default
```

`epub-to-book.ts` only parses the arguments, picks a book source and runs the steps (`pipeline/runner.ts`). A new kind of input is one more source in `pipeline/bookSources.ts`; a new step is one more entry in `PIPELINE_STEPS` in `pipeline/pipelineSteps.ts`, with its `shouldRun` and `run`. A step that throws stops the run.

The source prepares `public/bookv2-furigana/<book>/<book>.txt`:

- An EPUB: the text, images and metadata are extracted into the book folder (`core/epub-to-text-furigana.py`, which prints the book it wrote as a JSON line).
- An `ocr/ocr-pages.ts` output folder (see [Text That Is Not an EPUB](#text-that-is-not-an-epub)).
- `--skip-extract`: the text already in the book folder.

Then the steps:

1. Build `ruby-registry.json` from the EPUB's ruby (`core/extract-ruby-smart.py`), for an EPUB only. A failure here is reported and the run goes on, since the reader works without it. The reader reads registries from the database, so load it afterwards with `npx tsx scripts/db/import-ruby-registry.ts --apply` (see [db/README.md](db/README.md)).
2. Upload `images/` and the metadata JSON to the BookImages bucket when `BOOK_IMAGES_BUCKET` is set in `.env.local` (see "Book Illustrations" in the root README).
3. Rephrase the text chunk by chunk and add furigana to each rephrased chunk (`core/add-furigana-to-text.py`). Each chunk is saved to its own files in `chunks/`, and `<book>-rephrase.txt` and `<book>-rephrase-furigana.txt` (the text the reader shows) are rebuilt from them in chunk order. After each chunk the reader's file is upserted into `text_entries` on the local database (`db/sync-text-entry.ts`), so the book can be read while it is still being processed.

```
public/bookv2-furigana/<book>/
├── <book>.txt                       extracted text with furigana
├── <book>.json                      metadata, including the image list
├── images/                          illustrations
├── ruby-registry.json               vocabulary index
├── <book>-rephrase.txt              rephrase before furigana
├── <book>-rephrase-furigana.txt     rephrase with furigana (synced to the database)
├── <book>-rephrase-progress.json    resume state
└── chunks/                          one set of files per chunk, which the two outputs are built from
    ├── 0000.rephrase.txt            the model's reply
    ├── 0000.reader.txt              the text furigana is added to
    └── 0000.furigana.txt            what the reader shows
```

`public/bookv2-furigana/` is gitignored and never deployed. The app reads book text from the database and illustrations from the BookImages bucket.

### Rephrasing

- **Claude** (the default): a `--model` that does not start with `gemini`, such as `sonnet` or `opus`, runs `claude -p` on the Claude subscription with `prompts/claude-rephrase.md` as the system prompt. Chunks run one at a time, back to back with no delay: the usage limit is per account, so running calls side by side would only reach it sooner. When a call fails (usage limit, sign-in), the run stops and that chunk stays unfinished.
- **Gemini**: a `gemini-*` model sends each chunk to the Gemini API. It runs one worker per free key named `GEMINI_API_KEY`, `GEMINI_API_KEY2`, `GEMINI_API_KEY3` and so on (the key pool `ocr/ocr-pages.ts` also uses), so that many chunks are rephrased at once, each worker starting its chunks on its own key; with only `GEMINI_API_KEY_PAID`, one chunk at a time. A free key out of daily quota for the model is set aside for the rest of the run; once none is left, `GEMINI_API_KEY_PAID` takes over on the same model. When no key has quota left for the model, no new chunk starts, the chunks in flight finish, and the run stops like a Claude run does. A per-minute rate limit (429) waits as long as Gemini's reply asks, or 10s, 20s, 40s and so on up to 2 minutes, and tries the same key again without using up an attempt. A server error or a reply in the wrong format waits and retries on the next key. Only an unknown model (404) moves on to the next Gemini model. There is no fixed wait between chunks: the rate limits set the pace, and `--delay <n>` only keeps at least n seconds between two requests on the same key. A chunk whose attempts all fail keeps its original lines as their own rephrase, is marked `fallback`, and is retried on the next run.

Chunks run in parallel can finish out of order. The outputs are always rebuilt in chunk order, but until an earlier chunk finishes, the reader's file has a gap where it goes. The database is synced one call at a time, so the last sync always carries the newest file.

### Resuming

Progress is saved in `<book>-rephrase-progress.json`. Run the same command again to continue; a resumed run keeps the model and `--delay` the book started with. Ctrl+C stops the run at once, waits included: saved chunks are kept and the chunks in flight are redone on the next run. A second Ctrl+C kills the process if stopping hangs. It redoes every chunk that is not finished: pending chunks, `fallback` chunks, and chunks saved without furigana (only the furigana step is redone, from `chunks/<n>.reader.txt`, without asking the model again). The final summary lists the chunks still left, and the run reports itself incomplete until every chunk is rephrased with furigana.

A chunk counts as done only once its chunk files are written and the progress file says so, and the two outputs are always rebuilt from the chunk files. So a run killed at any point, or resumed any number of times, never repeats or reorders text. The progress file also stores a hash of each chunk's source: a chunk whose source no longer matches is redone. The script refuses to resume when the whole source text has changed since, or when the progress file cannot be read. `--reset` starts over and first moves the earlier `-rephrase.txt`, `-rephrase-furigana.txt` and `chunks/` aside as `.bak`. To fix text by hand in a book that has `chunks/`, edit the chunk file as well: a rerun rebuilds the two outputs from the chunk files and would undo an edit made only to the output.

A progress file from before chunk files (version 1) is moved over on the first resume: `-rephrase-furigana.txt` is split back into chunk files where its `<` lines, read without furigana, hold each chunk's source text in order, whether each `<` line is a source line (Claude) or a sentence (Gemini). `-rephrase.txt` is split the same way when it can be. Gemini's replies reword the original lines, so for a Gemini book it is kept whole as `-rephrase.txt.bak` and the moved-over chunks get empty replies; nothing reads that file. A chunk the earlier run was stopped in and had only partly saved is redone. If the reader's file does not hold the source text that way, as in a book whose reader file was rebuilt or edited after its run, the script stops and leaves the files untouched; `--reset` then starts the book over.

### Text That Is Not an EPUB

Pass the folder `ocr/ocr-pages.ts` wrote (`<image-dir>-ocr`, holding `pages/`, the joined `<book>.txt` and maybe `images/`). The joined text's name is the book name. The source adds furigana to the joined text, writes it to `public/bookv2-furigana/<book>/<book>.txt` under a `Title:`/`Author: Unknown` header, and copies the cropped figures to the book's `images/`, which step 2 uploads:

```bash
npx tsx scripts/epub-to-book.ts "temp/books/<book>-ocr"
```

Every run rebuilds `<book>.txt` from the OCR text, so OCR pages added later change the source, and the rephrase step then refuses to resume until `--reset`.

For any other text, such as a corrected source, put it at `public/bookv2-furigana/<book>/<book>.txt` yourself and pass any path whose name is the book name with `--skip-extract`. The ruby registry is skipped:

```bash
npx tsx scripts/epub-to-book.ts "public/bookv2-furigana/<book>" --skip-extract
```

### Before a Run

- Start the local database (`npm run db:start`). The dev server is not needed. Chunks are synced to `DATABASE_URL` from `.env.local`, or to `--database-url <url>`; any host other than `localhost` or `127.0.0.1` stops the run before the first chunk. Without a database URL the files are still written and nothing is synced. `--api-url` is still accepted but ignored
- Install the Python dependencies (see [Python Setup](#python-setup)) into the Python the pipeline calls: the `PYTHON` environment variable if set, else `.venv` or `venv` in the project root, else `py -3` on Windows and `python3` elsewhere. The pipeline stops before preparing the book when that Python cannot import MeCab
- Claude rephrasing needs the `claude` CLI signed in; Gemini rephrasing needs at least one `GEMINI_API_KEY<n>` in `.env.local`, or `GEMINI_API_KEY_PAID`

`--skip-images` has no effect: the extractor always writes the images.

The tests of the Python steps run the real Python on a small generated EPUB (`pipeline/fixtures/make-tiny-epub.py`) and are skipped where that Python lacks the packages, as in CI. The database tests run only with `PIPELINE_TEST_DATABASE_URL` set to a throwaway local database whose name ends in `_test`, with the schema applied.

### After a Run

The finished book is in the local database only. `npm run db:sync` and its push option copy it to production, as does the sync `npm run dev` runs when it stops. A new book also needs a cover (see "Book Covers" in the root README).

## Audiobook Narration (`audio/`)

Lets the reader's play button use a real narration instead of Google TTS. Needs the
recording plus a transcript of it — not the ebook text, it must match what is spoken.

```bash
# 1. Align transcript to audio -> .srt (for eyeballing) + .timings.json
python scripts/audio/align-transcript.py "book.m4b" "book.txt"

# 2. Map those cues onto reader units -> a build artifact (cue positions only);
#    --help lists the options, including the --min-coverage gate
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
