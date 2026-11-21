# Implementation Summary

Both requested features have been successfully implemented:

## Feature 1: Vocabulary Diary System

A comprehensive word diary system that allows you to save interesting words while reading, with full context and easy navigation back to the source.

### Components Created:
- **VocabularySaveDialog** (`app/components/ui/VocabularySaveDialog.tsx`): Modal for saving selected words with optional reading and notes
- **VocabularySidebar** (`app/components/ui/VocabularySidebar.tsx`): Sidebar showing today's saved words
- **Vocabulary Page** (`app/vocabulary/page.tsx`): Full list of all saved words with search functionality

### Database:
- Added `vocabulary_entries` table to `lib/db/schema.ts`
- Stores: word, reading (furigana), sentence context, source file location, notes, timestamps

### API Routes:
- `GET /api/vocabulary` - List all vocabulary entries (with filters: word, fileName, directory, today)
- `POST /api/vocabulary` - Create new vocabulary entry
- `GET /api/vocabulary/[id]` - Get specific entry
- `PUT /api/vocabulary/[id]` - Update entry (mainly notes)
- `DELETE /api/vocabulary/[id]` - Delete entry

### Features:
1. **Today's Words Sidebar**:
   - Quick access to words saved today
   - Shows word, reading, sentence preview, and notes
   - Click any word to navigate back to its source

2. **Full Vocabulary Page** (`/vocabulary`):
   - Opened from 単語帳 in the shared `AppHeader`
   - View all saved words in a grid layout
   - Search across word, reading, sentence, and notes
   - Click any word for detailed view
   - Delete functionality
   - Navigate back to source with word highlighting

3. **Word Highlighting**:
   - When navigating from vocabulary page to source
   - Paragraph containing the word gets highlighted (orange glow)
   - Highlight fades after 3 seconds

### How to Use:
1. View all words at `/vocabulary` page (単語帳 in the shared `AppHeader`)

---

## Feature 2: Basic Authentication

Simple password-only authentication to protect your Japanese reading helper from unauthorized access.

### Components Created:
- **Login Page** (`app/login/page.tsx`): Password-only login form
- **Middleware** (`middleware.ts`): Route protection for all pages except login
- **Auth Utilities**:
  - `lib/auth/session.ts` - JWT session management
  - `lib/auth/password.ts` - Password verification with bcrypt

### API Routes:
- `POST /api/auth/login` - Authenticate user
- `POST /api/auth/logout` - Clear session
- `GET /api/auth/session` - Check authentication status

### Security:
- Password hash stored in `.env.local`
- Session stored in httpOnly cookie (7-day expiration)
- JWT-based session tokens
- All routes protected except `/login` and auth API routes

### Features:
1. **Login Page** (`/login`):
   - Simple password-only form
   - No username required (single-user system)
   - Redirects to home page on success

2. **Session Management**:
   - 7-day session duration
   - Automatic login persistence via cookies
   - Secure httpOnly cookies (prevents XSS attacks)

3. **Logout Button**:
   - "ログアウト" button in the shared `AppHeader` (`app/components/ui/AppHeader.tsx`) on `/library`, `/vocabulary` and `/ruby-registry`
   - Clears session and redirects to login

4. **Route Protection**:
   - Middleware protects all routes
   - Unauthenticated users redirected to `/login`
   - Static files and Next.js internals excluded

### Credentials:
- Password stored securely as hash in `.env.local`
- No username needed (single-user system)

---

## Updated Constants and Types

### `lib/constants.ts`:
- Added `API_ROUTES.VOCABULARY`, `AUTH_LOGIN`, `AUTH_LOGOUT`, `AUTH_SESSION`
- Added `PAGE_ROUTES.VOCABULARY`, `LOGIN`

### `lib/types.ts`:
- Added `VocabularyEntry` interface
- Added `VocabularyListResponse`, `VocabularyCreateRequest`, `VocabularyUpdateRequest`, `VocabularyResponse`

---

## Modified Existing Files

### `app/components/ui/CollapsibleItem.tsx`:
- Added word highlighting effect when navigating from vocabulary page

---

## Environment Variables

Added to `.env.local`:
```bash
# Authentication (generate with: npx tsx scripts/auth/generate-password-hash.ts <password>)
AUTH_PASSWORD_HASH="<your-bcrypt-hash>"
SESSION_SECRET="<random-32-character-string>"
```

---

## Dependencies Added
- `bcryptjs` - Password hashing
- `jose` - JWT token management
- `@types/bcryptjs` - TypeScript definitions

---

## Testing

Build successful with no errors:
```bash
npm run build
Compiled successfully
```

All features are ready to use!
