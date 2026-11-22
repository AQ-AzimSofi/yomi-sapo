# Codebase Structure

This document describes the project structure for the よみサポ application.

## Directory Overview

```
yomi-sapo/
├── app/                    # Next.js App Router
│   ├── api/                # API routes
│   ├── components/         # Shared React components
│   ├── hooks/              # Custom React hooks
│   └── [pages]/            # Page directories
├── lib/                    # Core business logic
│   ├── ai/                 # AI/Gemini integration
│   ├── books/              # Book identity (BookRef)
│   ├── db/                 # Database layer
│   ├── services/           # Business services
│   ├── storage/            # S3 book storage
│   ├── utils/              # Utility functions
│   ├── auth/               # Authentication and API route guards
│   └── api/                # Browser API client, route contracts, response helpers
├── scripts/                # Utility scripts (Python/JS/TS)
├── public/                 # Static assets & text files
└── docs/                   # Documentation
```

---

## App Directory (`/app`)

### API Routes (`/app/api`)

| Route | Methods | Description |
|-------|---------|-------------|
| `/api/vocabulary` | GET, POST | Vocabulary entries |
| `/api/vocabulary/[id]` | GET, PUT, DELETE | Single vocabulary entry |
| `/api/read-public-txt` | GET | Read text file content |
| `/api/read-bookmark` | GET | Get bookmark position |
| `/api/write-bookmark` | POST | Update bookmark |
| `/api/list-text-files` | GET | List available text files |
| `/api/text-entries` | PUT | Copy a local book file into text_entries (dev server only) |
| `/api/explain-sentence` | POST | Sentence explanations |
| `/api/tts` | POST | Text-to-speech |
| `/api/ruby-registry` | GET, POST | Furigana registry |
| `/api/init-db` | GET | Initialize database tables |
| `/api/health` | GET | Health check |
| `/api/auth` | POST | Authentication |

Every handler is declared as `export const GET = withAuth(policy, handler)` (`lib/auth/guards.ts`) with one of four policies:

- `owner`: needs a valid session; anyone else gets 401.
- `viewer`: the handler receives `'owner' | 'guest'` and decides (guest previews answer 403 outside the allowlist; the AI and speech routes answer 401 with `requiresGuestKey` when a guest sends no key).
- `admin-key`: needs `x-api-key` to equal `ADMIN_API_KEY`.
- `public`: no check.

`app/api/routeInventory.test.ts` lists the expected policy of every handler and fails on a handler that is missing from the list or declares another policy.

`read-public-txt`, `read-bookmark`, `write-bookmark`, `narration`, `covers` and `text-entries` read their book as a `BookRef` (`lib/books/bookRef.ts`) from separate `directory` and `fileName` params (`write-bookmark` and `text-entries`: body fields), and reject one that fails `isSafeBookRef` with 400. `ruby-registry` checks its `directory` and `bookName` the same way. `vocabulary` and `admin` still take a raw `fileName` and `directory` with no check; both only pass them to parameterized SQL. `read-public-txt`, `read-bookmark` and `write-bookmark` still accept the combined form (`fileName=dir/file`, or `target` in the bookmark body), because a browser can hold the reader from before a deploy. `read-public-txt` keeps its old lookup for that form: every directory/file split, most nested first, then the legacy `public` folder.

`POST /api/vocabulary` answers `created: false` with the stored entry when the same word was already saved from the same sentence of the same book (`isSameSavedWord` in `lib/vocabulary/duplicates.ts`, sentences compared without furigana), so saving twice never makes a copy. There is no unique index behind it: two saves sent at the same moment could still both be stored.

Errors are `{ error: { code, message } }` from `apiError()` (`lib/api/respond.ts`), plus any field a client reads (`requiresGuestKey`, the top-level `message` of the login and vocabulary list errors). Request and response bodies are typed in `lib/api/contracts.ts`, which both the handlers and the browser client import. `parseJsonBody(request, check, requirement)` answers 400 for a body that is not JSON or fails `check`. An error a handler does not handle is logged and answered with a generic 500.

### Components (`/app/components`)

```
components/
├── icons/              # Icon components
│   ├── BookmarkFilled.tsx
│   ├── BookmarkUnfilled.tsx
│   ├── SpeakerIcon.tsx
│   ├── StartHereIcon.tsx
│   └── TranslateIcon.tsx
├── reading/            # Reader components
│   ├── ReaderItem.tsx          # One reading unit: rephrase head with やさしく sub-items, or a paragraph
│   ├── ParagraphText.tsx       # Book text with furigana, optionally one clickable span per sentence
│   ├── IconButton.tsx          # 32px item action button
│   ├── ExplanationSidebar.tsx  # AI explanations panel
│   ├── RubyLookupSidebar.tsx   # Furigana lookup
│   ├── TTSButton.tsx           # Read-aloud button, drawn from the reader's one player
│   ├── GuestApiKeyModal.tsx    # Guest Gemini key prompt
│   └── BookImage.tsx           # Book illustration
└── ui/                 # Shared UI components
    ├── AppHeader.tsx           # Shared header (logo, 本棚/単語帳 nav, ログアウト)
    ├── BottomSheet.tsx         # Mobile bottom sheet
    └── GuestModeBanner.tsx     # Guest preview banner
```

### Hooks (`/app/hooks`)

| Hook | Purpose |
|------|---------|
| `useExplanationCache` | Cache AI explanations in localStorage |
| `useBookMetadata` | Load book metadata from JSON |
| `useTTS` | Text-to-speech control |
| `useRubyRegistry` | Manage furigana registry |
| `useAudioBook` | Reader audio playback (narration or TTS) |
| `useNarration` | Load a book's narration manifest |
| `useGuestMode` | Whether the visitor is a guest |

Import each hook from its own file:

```typescript
import { useExplanationCache } from '@/app/hooks/useExplanationCache';
```

### Pages

| Page | Path | Description |
|------|------|-------------|
| Home | `/` | Redirects to /library |
| Read | `/read` | Enhanced reader |
| Library | `/library` | Book library |
| Vocabulary | `/vocabulary` | Vocabulary tracker |
| Ruby Registry | `/ruby-registry` | Furigana management |
| Login | `/login` | Authentication |

`/library`, `/vocabulary` and `/ruby-registry` share `AppHeader` (`app/components/ui/AppHeader.tsx`): the logo links to `/library`, the nav holds 本棚, 単語帳 and ログアウト, and a page can add its own actions (the library adds 同期).

---

## Lib Directory (`/lib`)

### AI Module (`/lib/ai`)

Handles all Gemini AI integration.

```
ai/
├── index.ts            # Barrel export
├── client.ts           # AI client singleton (server-only)
└── prompts/
    ├── index.ts        # Prompts barrel export
    ├── rephrase.ts     # Text rephrasing prompts
    └── explanation.ts  # Sentence explanation prompts (5 modes)
```

**Usage:**
```typescript
// Server-only (API routes)
import { getAIClient } from '@/lib/ai';

// Client-safe (prompts only)
import { ai_instructions, ai_instructions_quick } from '@/lib/ai';
```

### Database Layer (`/lib/db`)

Raw SQL database operations using the `postgres` library.

```
db/
├── connection.ts           # PostgreSQL connection pool
├── schema.ts               # TypeScript interfaces & CREATE TABLE SQL
├── queries.ts              # Bookmark & text entry queries
├── vocabularyQueries.sql.ts # Vocabulary queries
└── vocabularyDto.ts        # Vocabulary row -> camelCase API entry
```

**Key Interfaces:**
- `Bookmark`, `TextEntry`, `VocabularyRow`

Rows come back from postgres.js in snake_case. The vocabulary queries map each `VocabularyRow` through `toVocabularyDto` (`vocabularyDto.ts`) and return the camelCase `VocabularyEntry` from `lib/types.ts`, the shape `/api/vocabulary` sends and the vocabulary page reads.

**Usage:**
```typescript
import { getBookmark, upsertBookmark } from '@/lib/db/queries';
import { getVocabularyEntries } from '@/lib/db/vocabularyQueries.sql';
```

### Services (`/lib/services`)

```
services/
└── fileService.ts      # Book files and ruby registries on disk
```

**fileService functions:**
- `readTextFile(fileName)`
- `readRubyRegistry`, `writeRubyRegistry`, `upsertRubyEntry`, `deleteRubyEntry`, `ignoreSuggestion`

### API client (`/lib/api`)

Browser code reaches the API routes only through `lib/api/client.ts`, which has one typed function per call (`fetchBookText`, `fetchBookmark`, `saveBookmark`, `translate`, `explainSentence`, `prioritize`, `synthesizeSpeech`, `fetchNarration`, the vocabulary, ruby registry, library, auth and db-sync calls). Each goes through one `request()` helper:

- Builds the URL from `API_ROUTES`, encoding params the way `bookQuery` does, and sends a body as JSON.
- Attaches the guest's own key header (`lib/guestKeys.ts`) for the paid routes and passes an `AbortSignal` through.
- Throws `ApiError` for a response outside 2xx, with `status`, `statusText` and the parsed error `body`. A failed paid request opens the guest key modal through `promptGuestKeyOnFailure`, after any failure or (for `prioritize`) only after a 401, and `promptedGuestKey` says whether it did.

`fetchBookmark` and `fetchBookMetadata` answer null for an error response, and `fetchNarration` for 401, 404 or a non-JSON answer; pages treat those as "none". Components can mock the client module in tests.

`fetchBookText` reads through `lib/bookTextCache.ts`: CloudFront drops `If-None-Match`, so the reader keeps each book in Cache Storage (`book-text-v2`) and sends the stored ETag in `x-book-version`; the server answers 204 while that copy is current. Opening the cache deletes any other `book-text-*` cache, such as `book-text-v1` from before books were requested with separate `directory` and `fileName` params, and signing out deletes them all.

### Book identity (`/lib/books`)

`bookRef.ts` names a book: `interface BookRef { directory: string; fileName: string }`, the same pair as a `text_entries` row.

- `toBookKey(book)` / `parseBookKey(key)`: the joined `"directory/fileName"` key, whose last segment is the file. A key with no slash names a book in the legacy `public` folder. Bookmark rows, library progress (`/api/library-progress` keys) and the old combined query param all use this key.
- `bookRefFromParams(directory, fileName)`: the book named by URL or query params, or by a combined `fileName` alone. Both go through the joined key, so both forms resolve to the same book, and to the same bookmark row as before the split.
- `sameBook(a, b)`: the same directory and file name.
- `isSafeBookRef(book)`: no `..` part, no empty part (so no leading, doubled or trailing slash) and no backslash. Every route that reads a book as a `BookRef` checks it, as does `ruby-registry` (see API Routes).
- `bookQuery(book)`: the `directory=...&fileName=...` query string clients send.
- `rubyRegistryKey(book)`: the top-level directory and the rest of the book's directory, the key ruby registries and starred words are stored under.

`lib/publicBooks.ts` matches the guest-preview allowlist through `findPublicBook` (via `sameBook`); `isPublicDirectory` and `isPublicBookAsset` answer for a preview book's folder.

### Storage (`/lib/storage`)

`s3.ts` holds one module-level `S3Client`:

- `readObjectBytes(bucket, key)`: the whole object as a `Uint8Array`, or `null` when S3 answers `NoSuchKey`/`NotFound`. It reads the body fully, so a failure mid-read is a 500 rather than a cached, truncated 200.
- `presignGet(bucket, key, expiresInSeconds)`: a presigned GET URL.

`/api/covers` and `/api/book-assets` read through `readObjectBytes`; `/api/narration` signs its recording URL with `presignGet`.

### Book model (`/lib/content`)

`bookModel.ts` owns how a book's text becomes reader units: format detection, newline handling, unit splitting, page math (`pageStartIndex`, `pageOfIndex`, `totalPagesFor`) and bookmark lookup (`findBookmarkIndex`, `bookmarkPageFor`). The reader, the library, the guest preview and the narration builder all use it.

### Utilities (`/lib/utils`)

```
utils/
├── furiganaParser.ts       # Parse kanji[furigana] and <ruby> tags, render escaped HTML
├── html.ts                 # HTML escaping
├── safeMarkdown.ts         # Render AI markdown with raw HTML escaped
├── truncatePreview.ts      # Guest preview cut
├── ttsTextCleaner.ts       # Clean text for TTS
├── ttsCache.ts             # Cache synthesized TTS audio
├── colorTint.ts            # toTint(): tint a theme color
├── bookAssetPath.ts        # Paths and URLs of book images and metadata
├── bookTitle.ts            # Display title from a file name
└── markdownParser/         # Rephrase-format parser
    ├── index.ts
    ├── validator.ts
    ├── normalizer.ts
    └── splitter.ts
```

**Usage:**
```typescript
import { parseFurigana } from '@/lib/utils/furiganaParser';
import { parseMarkdown } from '@/lib/utils/markdownParser';
```

### Other Lib Modules

```
lib/
├── constants.ts        # App configuration (AI_MODELS, API_ROUTES, etc.)
├── types.ts            # TypeScript type definitions
├── api/
│   ├── client.ts       # Browser API client: request(), ApiError, one function per call
│   ├── contracts.ts    # Request and response types of the routes the browser calls
│   └── respond.ts      # apiError, parseJsonBody, the generic 500
├── auth/
│   ├── guards.ts       # getViewer and withAuth (owner, viewer, admin-key, public)
│   ├── password.ts     # Password hashing
│   └── session.ts      # Session management
├── books/
│   └── bookRef.ts      # BookRef, the book key, isSafeBookRef
└── storage/
    └── s3.ts           # Shared S3 client, readObjectBytes, presignGet
```

---

## Scripts Directory (`/scripts`)

Utility scripts for data processing:

| Script | Language | Purpose |
|--------|----------|---------|
| `add-furigana.js` | JavaScript | Add furigana to text |
| `add-furigana-improved.js` | JavaScript | Improved furigana processing |
| `add-furigana-final.js` | JavaScript | Final furigana version |
| `clean-and-add-furigana.js` | JavaScript | Clean text + add furigana |
| `epub-to-text.py` | Python | Convert EPUB to text |
| `epub-to-text-furigana.py` | Python | EPUB to text with furigana |
| `extract-ruby-from-epub.py` | Python | Extract ruby annotations |
| `add-furigana-to-text.py` | Python | Python furigana processor |
| `batch-rephrase.ts` | TypeScript | Batch AI rephrasing |
| `migrate-ruby-registry.py` | Python | Ruby registry migration |

---

## Public Directory (`/public`)

Static assets and text files:

```
public/
├── bookv1-rephrase/    # AI-rephrased books
├── bookv2-furigana/    # Books with furigana
├── bookv3-rephrase/    # Additional rephrased books
└── [other assets]
```

---

## Database Schema

Tables are created via `/api/init-db`:

| Table | Purpose |
|-------|---------|
| `bookmarks` | File-based bookmark positions |
| `text_entries` | Stored text content |
| `narration` | Audiobook narration manifests |
| `vocabulary_entries` | User vocabulary diary |

The old Prisma tables (`"Book"`, `"BookImage"`, `"ProcessingHistory"`, `"UserBookmark"`) still exist in both databases but nothing reads them, and they are not synced.

---

## Import Conventions

Import from the module that defines the function; only `lib/ai` keeps a barrel:

```typescript
// Database
import { getBookmark } from '@/lib/db/queries';
import { getVocabularyEntries } from '@/lib/db/vocabularyQueries.sql';

// Services
import { readTextFile } from '@/lib/services/fileService';

// Utilities
import { parseFurigana } from '@/lib/utils/furiganaParser';

// AI
import { getAIClient, ai_instructions_quick } from '@/lib/ai';

// Hooks
import { useExplanationCache } from '@/app/hooks/useExplanationCache';
```

---

## Environment Variables

Required in `.env.local`:

```bash
# AI Service
GEMINI_API_KEY=your_api_key

# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/dbname
POSTGRES_URL=postgresql://user:pass@localhost:5432/dbname

# Auth (optional)
AUTH_PASSWORD_HASH=bcrypt_hash
```

---

## Development Commands

```bash
npm run dev           # Start dev server (port 3333)
npm run build         # Production build
npm run db:start      # Start PostgreSQL container
npm run db:init       # Initialize database schema
npm run db:migrate    # Bring the local database to the current schema
```
