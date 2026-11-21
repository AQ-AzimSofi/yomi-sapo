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
│   ├── db/                 # Database layer
│   ├── services/           # Business services
│   ├── utils/              # Utility functions
│   ├── auth/               # Authentication and API route guards
│   └── api/                # API response and request-body helpers
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
- `public`: no check. `app/api/routeInventory.test.ts` keeps an allowlist of these and fails on a handler with no policy.

Errors are `{ error: { code, message } }` from `apiError()` (`lib/api/respond.ts`), plus any field a client reads (`requiresGuestKey`, the login page's `message`). `parseJsonBody(request, check, requirement)` answers 400 for a body that is not JSON or fails `check`. An error a handler does not handle is logged and answered with a generic 500.

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
│   ├── CollapsibleItem.tsx     # Collapsible text with rephrasing
│   ├── ExplanationSidebar.tsx  # AI explanations panel
│   ├── ParagraphItem.tsx       # Individual paragraph
│   ├── RubyLookupSidebar.tsx   # Furigana lookup
│   ├── TTSButton.tsx           # Text-to-speech button
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
│   └── respond.ts      # apiError, parseJsonBody, the generic 500
├── auth/
│   ├── guards.ts       # getViewer and withAuth (owner, viewer, admin-key, public)
│   ├── password.ts     # Password hashing
│   └── session.ts      # Session management
└── storage/
    └── blobStorage.ts  # Blob storage operations
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
