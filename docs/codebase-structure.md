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
│   ├── auth/               # Authentication
│   └── middleware/         # Request middleware
├── scripts/                # Utility scripts (Python/JS/TS)
├── public/                 # Static assets & text files
├── docs/                   # Documentation
└── prisma/                 # Database schema (legacy)
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
| `/api/text-entries` | GET, DELETE, PUT | Database text entries |
| `/api/text-entries/reset` | POST | Reset text entries |
| `/api/explain-sentence` | POST | Sentence explanations |
| `/api/tts` | POST | Text-to-speech |
| `/api/ruby-registry` | GET, POST | Furigana registry |
| `/api/init-db` | GET | Initialize database tables |
| `/api/health` | GET | Health check |
| `/api/auth` | POST | Authentication |

### Components (`/app/components`)

```
components/
├── icons/              # Icon components
│   ├── BookmarkFilled.tsx
│   ├── BookmarkUnfilled.tsx
│   ├── ChevronDown.tsx
│   ├── ChevronUp.tsx
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

**Barrel Export:** Import from `@/app/hooks`

```typescript
import { useExplanationCache, useBookMetadata } from '@/app/hooks';
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
├── index.ts                # Barrel export
├── connection.ts           # PostgreSQL connection pool
├── schema.ts               # TypeScript interfaces & CREATE TABLE SQL
├── queries.ts              # Bookmark & text entry queries
└── vocabularyQueries.sql.ts # Vocabulary queries (replaced Prisma)
```

**Key Interfaces:**
- `Book`, `BookImage`, `ProcessingHistory`
- `UserBookmark`, `VocabularyEntry`
- `Bookmark`, `TextEntry`

**Usage:**
```typescript
import { getBookmark, upsertBookmark } from '@/lib/db';
import { getVocabularyEntries } from '@/lib/db';
```

### Services (`/lib/services`)

```
services/
├── index.ts            # Barrel export
└── fileService.ts      # File system operations
```

**fileService functions:**
- `readTextFile(fileName, directory?)`
- `writeTextFile(fileName, content, directory?)`
- `readBookmark(fileName, directory?)`
- `updateBookmark(fileName, content, directory?)`
- `listTextFiles()` - Returns `{directories, filesByDirectory, files}`
- `syncBookmarks()` - Cleanup + initialize bookmarks

### Utilities (`/lib/utils`)

```
utils/
├── index.ts                # Barrel export
├── furiganaParser.ts       # Parse kanji[furigana] and <ruby> tags, render escaped HTML
├── html.ts                 # HTML escaping
├── safeMarkdown.ts         # Render AI markdown with raw HTML escaped
├── buildPlayableUnits.ts   # Split book text into reader units
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
import { parseFurigana, parseMarkdown } from '@/lib/utils';
```

### Other Lib Modules

```
lib/
├── constants.ts        # App configuration (AI_MODELS, API_ROUTES, etc.)
├── types.ts            # TypeScript type definitions
├── auth/
│   ├── password.ts     # Password hashing
│   └── session.ts      # Session management
├── middleware/
│   └── auth.ts         # Auth middleware
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
| `books` | Book metadata from EPUB |
| `book_images` | Images extracted from EPUB |
| `processing_history` | EPUB processing records |
| `user_bookmarks` | User bookmarks linked to books |
| `vocabulary_entries` | User vocabulary diary |

---

## Import Conventions

Use barrel exports for cleaner imports:

```typescript
// Database
import { getBookmark, getVocabularyEntries } from '@/lib/db';

// Services
import { readTextFile } from '@/lib/services';

// Utilities
import { parseFurigana, parseMarkdown } from '@/lib/utils';

// AI
import { getAIClient, ai_instructions } from '@/lib/ai';

// Hooks
import { useExplanationCache, useBookMetadata } from '@/app/hooks';
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
npm run db:migrate    # Migrate text files to database
```
