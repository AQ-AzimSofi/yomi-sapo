# Frontend Architecture Documentation

This document provides a comprehensive overview of the Japanese Reading Helper frontend architecture, including all pages, components, styling, and patterns.

## Table of Contents

1. [Tech Stack](#tech-stack)
2. [Design Philosophy](#design-philosophy)
3. [Page Structure](#page-structure)
4. [Component Architecture](#component-architecture)
5. [Styling System](#styling-system)
6. [State Management](#state-management)
7. [Hooks](#hooks)
8. [User Flows](#user-flows)
9. [Responsive Design](#responsive-design)
10. [Accessibility](#accessibility)

---

## Tech Stack

| Technology | Version | Purpose |
|------------|---------|---------|
| Next.js | 15.4.5 | App Router framework |
| React | 19.1.0 | UI library |
| TypeScript | 5 | Type safety |
| Tailwind CSS | 4 | Utility-first styling |
| Noto Serif JP | - | Japanese typography |

---

## Design Philosophy

The frontend follows a **minimal, reading-focused** design philosophy:

1. **Content-first**: Reading area maximized, UI chrome hidden by default
2. **Library-first navigation**: File selection in dedicated library page
3. **Essential features only**: Bookmark + Furigana as primary controls
4. **Progressive disclosure**: Advanced features available but not prominent
5. **Warm, inviting aesthetic**: Cream/beige color palette for comfortable reading

---

## Page Structure

### Route Overview

\`\`\`
/                    -> Redirects to /library
/library             -> Book library grid view
/read                -> Minimal distraction-free reader
/vocabulary          -> Saved vocabulary list
/ruby-registry       -> Character name readings management
/login               -> Authentication page
\`\`\`

### Page Details

#### \`/library\` - Library Page
**File**: \`app/library/page.tsx\`

The entry point for browsing and selecting books.

**Features**:
- One grid of all books with sort options (最近読んだ, 追加順, 進捗, タイトル); each card shows the title, progress and character count
- Progress bar per book showing reading completion
- Shared \`AppHeader\` with 本棚, 単語帳, 同期 and ログアウト

**Components Used**:
- \`AppHeader\` - Shared page header
- \`LibraryGrid\` - Main grid container
- \`ContinueReading\` - Card for the book you were last reading
- \`BookCover\` - Cover image of a book
- \`DbSyncModal\` - Local and production sync dialog
- \`BookCard\` - Individual book card

**Navigation**:
- Click book -> \`/read?directory=x&fileName=y\`
- 単語帳 -> \`/vocabulary\`
- 同期 -> Opens the database sync dialog (\`DbSyncModal\`)
- ログアウト -> Clears the session and goes to \`/login\`

---

#### \`/read\` - Minimal Reader
**File**: \`app/read/page.tsx\`

The primary reading experience with distraction-free design.

**Features**:
- Full-width content with minimal chrome
- Thin progress bar at top (4px)
- Floating Action Button (FAB) in bottom-right
- Tap zones for page navigation
- Auto-hides controls after 3 seconds

**Components Used**:
- \`ProgressBar\` - Top progress indicator
- \`ReaderFAB\` - Floating action button with controls
- \`ReaderSettings\` - Slide-out settings panel
- \`ReadingContent\` - Content type detection and rendering
- \`CollapsibleItem\` - For rephrase-format content
- \`ParagraphItem\` - For furigana-format content
- \`ExplanationSidebar\` - AI sentence explanations

**URL Parameters**:
- \`directory\` - Book directory
- \`fileName\` - Book file name
- \`page\` - Current page number

**Tap Zones**:
- Left 20%: Previous page
- Right 20%: Next page
- Center: Show/hide FAB

---

## Component Architecture

### Directory Structure

\`\`\`
app/
├── components/
│   ├── reading/                   # Reader components
│   │   ├── CollapsibleItem.tsx    # Expandable reading unit
│   │   ├── ParagraphItem.tsx      # Paragraph display
│   │   ├── ExplanationSidebar.tsx # AI explanation panel
│   │   ├── RubyLookupSidebar.tsx  # Ruby lookup panel
│   │   ├── TTSButton.tsx          # Text-to-speech button
│   │   ├── GuestApiKeyModal.tsx   # Guest Gemini key prompt
│   │   └── BookImage.tsx          # Book illustration
│   ├── ui/                        # Shared UI components
│   │   ├── AppHeader.tsx          # Shared page header
│   │   ├── BottomSheet.tsx        # Mobile bottom sheet
│   │   └── GuestModeBanner.tsx    # Guest preview banner
│   └── icons/                     # Icon components
├── library/
│   ├── page.tsx                   # Library page
│   └── components/
│       ├── LibraryGrid.tsx        # Book grid
│       ├── ContinueReading.tsx    # Last book you were reading
│       ├── BookCard.tsx           # Book card
│       ├── BookCover.tsx          # Cover image
│       └── DbSyncModal.tsx        # Sync dialog
└── read/
    ├── page.tsx                   # Minimal reader
    └── components/
        ├── ProgressBar.tsx        # Top progress line
        ├── ReaderFAB.tsx          # Floating action button
        ├── ReaderSettings.tsx     # Settings panel
        └── ReadingContent.tsx     # Content renderer
\`\`\`

### Key Components

#### \`CollapsibleItem\`
**File**: \`app/components/reading/CollapsibleItem.tsx\`

The primary reading unit for rephrase-format content.

**Props** (main ones):
\`\`\`typescript
interface CollapsibleItemProps {
  id?: string;
  head: string;                    // Original Japanese text
  subItems: string[];              // Rephrasings (3 variations)
  initialDropdownState?: boolean;
  onSubmitSuccess: () => void;
  showFurigana?: boolean;
  aiExplanationEnabled?: boolean;
  onSentenceClick?: (sentence: string) => void;
  imageMap?: Record<string, string>;
  bookDirectory?: string;
  bookFileName?: string;
  onStartContinuousPlay?: () => void;
}
\`\`\`

**Features**:
- Expandable header with sub-items
- Bookmark icon (circular, filled/unfilled)
- TTS button with long-press for continuous play
- Sentence click for AI explanation
- Furigana support (bracket and ruby formats)
- Image placeholder rendering

---

#### \`ParagraphItem\`
**File**: \`app/components/reading/ParagraphItem.tsx\`

Paragraph display for furigana-format content.

**Props** (main ones):
\`\`\`typescript
interface ParagraphItemProps {
  id?: string;
  text: string;
  isBookmarked: boolean;
  fileName: string;
  showFurigana: boolean;
  onBookmarkSuccess: () => void;
  onSentenceClick?: (sentence: string) => void;
  imageMap?: Record<string, string>;
}
\`\`\`

---

#### \`ReaderFAB\`
**File**: \`app/read/components/ReaderFAB.tsx\`

Floating action button for reader controls.

**Props**:
\`\`\`typescript
interface ReaderFABProps {
  onBookmark: () => void;
  onToggleFurigana: () => void;
  onOpenSettings: () => void;
  isFuriganaEnabled: boolean;
  isBookmarked: boolean;
}
\`\`\`

**Behavior**:
- Auto-hides after 3 seconds of inactivity
- Expands on tap to reveal action buttons
- Actions: Bookmark, Furigana toggle, Settings, Library

---

#### \`ReadingContent\`
**File**: \`app/read/components/ReadingContent.tsx\`

Renders the parsed items of the current page. Format detection lives in \`lib/content/bookModel.ts\`:

- \`rephrase\`: a line starting with \`>>\` and a heading line starting with \`<\` or \`＜\` (not a ruby tag)
- \`furigana\`: \`<ruby>\` markup or text followed by a \`[bracketed]\` reading
- \`plain\`: anything else

- \`rephrase\`: Renders with \`CollapsibleItem\`
- \`furigana\`/\`plain\`: Renders with \`ParagraphItem\`

---

#### \`ExplanationSidebar\`
**File**: \`app/components/reading/ExplanationSidebar.tsx\`

AI-powered sentence explanation panel.

**Features**:
- 5 explanation modes: Quick, Story, Nuance, Speaker, Narrative
- Context size slider (10-100 characters)
- Explanation caching in localStorage
- Swipe-to-close on mobile (100px threshold)
- ESC key to close

---

#### \`AppHeader\`
**File**: \`app/components/ui/AppHeader.tsx\`

Shared page header for \`/library\`, \`/vocabulary\` and \`/ruby-registry\`. The root layout adds no navigation; \`/read\` and \`/login\` do not use this header.

**Props**:
\`\`\`typescript
interface AppHeaderProps {
  currentPage?: 'library' | 'vocabulary';  // Nav item shown as the current page
  isGuest?: boolean;                       // Hides the nav for guests
  extraActions?: ReactNode;                // Page-specific nav buttons
}
\`\`\`

**Behavior**:
- Logo links to \`/library\`
- Nav: 本棚 (\`/library\`), 単語帳 (\`/vocabulary\`), any \`extraActions\`, then ログアウト
- The library passes a 同期 button as \`extraActions\`
- ログアウト calls \`/api/auth?action=logout\` and redirects to \`/login\`

---

## Styling System

### Color Palette

Defined in \`lib/constants.ts\`:

\`\`\`typescript
export const COLORS = {
  BASE: '#FFF0DD',           // Warm cream - backgrounds, highlights
  NEUTRAL: '#D1D3D8',        // Light gray - borders, surfaces
  PRIMARY: '#E2A16F',        // Tan/gold - important actions, AI features
  PRIMARY_DARK: '#d18a54',   // Dark tan - hover states
  SECONDARY: '#86B0BD',      // Blue-gray - standard operations
  SECONDARY_DARK: '#6a98a8', // Dark blue-gray - hover states
} as const;

export const READER_THEME = {
  SURFACE: '#FFF0DD',
  SURFACE_MUTED: '#FFF8F0',
  FAB_BG: '#E2A16F',
  FAB_ICON: '#FFFFFF',
  PROGRESS_TRACK: '#D1D3D8',
  PROGRESS_FILL: '#86B0BD',
  TRANSITION_FAST: '150ms',
  TRANSITION_NORMAL: '300ms',
} as const;
\`\`\`

### CSS Variables

Defined in \`app/globals.css\`:

\`\`\`css
:root {
  --background: #fff0dd82;
  --foreground: #171717;
  --color-base: #FFF0DD;
  --color-neutral: #D1D3D8;
  --color-primary: #E2A16F;
  --color-primary-dark: #d18a54;
  --color-secondary: #86B0BD;
  --color-secondary-dark: #6a98a8;
}
\`\`\`

### Typography

**Japanese Text (Reading Content)**:
\`\`\`css
.collapsibleItem, .collapsibleItem p {
  font-size: 1.3rem !important;
  font-family: Noto Serif JP;
  font-weight: 500;
  line-height: 1.5;
}
\`\`\`

**Furigana**:
\`\`\`css
rt {
  user-select: none;  /* Prevent selection */
}

.reader-content rt {
  font-size: 0.5em;
  color: var(--color-secondary-dark);
}
\`\`\`

### Using Colors in Components

**Via CSS Variables**:
\`\`\`typescript
style={{ backgroundColor: 'var(--color-base)' }}
\`\`\`

**Via Direct Values**:
\`\`\`typescript
import { COLORS, READER_THEME } from '@/lib/constants';

style={{ backgroundColor: COLORS.PRIMARY }}  // Uses #E2A16F
\`\`\`

**Color Mixing (Semi-transparent)**:
\`\`\`typescript
style={{
  backgroundColor: \`color-mix(in srgb, \${COLORS.PRIMARY} 20%, transparent)\`
}}
\`\`\`

---

## State Management

### URL Parameters (Navigation State)

| Parameter | Usage | Example |
|-----------|-------|---------|
| \`directory\` | Book subdirectory | \`bookv2-furigana\` |
| \`fileName\` | Book file name | \`chapter-1\` |
| \`page\` | Current page number | \`1\` |
| \`highlight\` | Word to highlight | \`word\` |

### LocalStorage (Persistent Preferences)

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| \`furigana_enabled\` | boolean | false | Show furigana annotations |
| \`ai_explanation_enabled\` | boolean | false | Enable sentence explanations |
| \`reader_font_size\` | number | 16 | Font size in pixels |
| \`reader_line_height\` | number | 1.8 | Line height multiplier |
| \`explanation_mode\` | string | 'quick' | Selected explanation type |
| \`explanation_context_size\` | number | 50 | Context window size |
| \`tts_speed\` | number | 1.0 | TTS playback speed |
| \`tts_voice_gender\` | string | 'FEMALE' | TTS voice selection |

### Custom Events (Cross-Component Sync)

| Event | Sent by | Purpose |
|-------|---------|---------|
| \`starredWordsChanged\` | \`RubyLookupSidebar\` | Starred ruby words changed; sticky notes reload |
| \`guestKeyRequired\` / \`guestKeyUpdated\` | \`lib/guestKeys.ts\` | A guest needs, or just saved, their own API key |

---

## Hooks

### \`useExplanationCache\`
**File**: \`app/hooks/useExplanationCache.ts\`

Manages localStorage caching for AI explanations.

\`\`\`typescript
const { getCache, setCache, mode, contextSize } = useExplanationCache();
\`\`\`

### \`useBookMetadata\`
**File**: \`app/hooks/useBookMetadata.ts\`

Loads book metadata including image mappings.

\`\`\`typescript
const { imageMap, metadata } = useBookMetadata(fileName, directory);
\`\`\`

### \`useTTS\`
**File**: \`app/hooks/useTTS.ts\`

Text-to-speech playback of one sentence (used by \`TTSButton\`).

\`\`\`typescript
const { isPlaying, play, pause, resume, stop } = useTTS();
\`\`\`

---

## User Flows

### Primary Reading Flow

\`\`\`
1. User visits /
   |
2. Redirect to /library
   |
3. User browses book grid
   |
4. Click book card
   |
5. Navigate to /read?directory=x&fileName=y
   |
6. Minimal reader loads
   |
7. User reads content
   |
8. Tap left/right edges to navigate pages
   |
9. Tap center to show FAB
   |
10. Use FAB for bookmark/furigana/settings
\`\`\`

### Bookmark Flow

\`\`\`
1. User taps center to show FAB
   |
2. FAB expands
   |
3. Tap bookmark icon
   |
4. Current page saved to API
   |
5. Visual feedback (icon fills)
   |
6. Next visit auto-navigates to bookmark
\`\`\`

### AI Explanation Flow

\`\`\`
1. Enable AI explanation in settings
   |
2. Long-press or click sentence
   |
3. ExplanationSidebar opens
   |
4. Select explanation mode
   |
5. API call to Gemini
   |
6. Explanation displayed
   |
7. Result cached in localStorage
\`\`\`

---

## Responsive Design

### Breakpoints

| Breakpoint | Size | Usage |
|------------|------|-------|
| Mobile | < 768px | Full-width |
| Tablet | 768px+ | Increased margins |
| Desktop | 1024px+ | Larger content area |

### Layout Patterns

**Library Grid**:
\`\`\`
Mobile:  2 columns
Tablet:  3 columns
Desktop: 4 columns
\`\`\`

**Reader Content**:
\`\`\`
Mobile:  mx-4, full width
Tablet:  max-w-3xl, centered
Desktop: max-w-3xl, centered
\`\`\`

**Settings Panel**:
\`\`\`
Mobile:  Full screen height, 90vw width
Desktop: 320px fixed width
\`\`\`

---

## Accessibility

### Keyboard Navigation

| Key | Action |
|-----|--------|
| \`ESC\` | Close sidebars |
| \`Ctrl+K\` or \`/\` | Toggle Ruby Lookup |
| \`Tab\` | Navigate focusable elements |

### ARIA Labels

All interactive elements include appropriate ARIA labels:
- Buttons have \`aria-label\` descriptions
- Current page uses \`aria-current="page"\`
- Dialogs use proper role attributes

### Touch Targets

- Minimum 44x44px for interactive elements
- FAB button: 56x56px
- Book cards: Full card clickable

### Color Contrast

- Text on cream background: sufficient contrast
- Primary color (#E2A16F) used for emphasis
- Secondary color (#86B0BD) for less prominent elements

---

## File Reference

### Constants
- \`lib/constants.ts\` - All configuration, colors, and constants

### Types
- \`lib/types.ts\` - TypeScript interfaces and types

### Utilities
- \`lib/utils/markdownParser/\` - AI response parsing
- \`lib/utils/furiganaParser.ts\` - Furigana rendering

### Styles
- \`app/globals.css\` - Global styles and CSS variables

### API Routes
- See \`lib/constants.ts\` -> \`API_ROUTES\` for all endpoints
- Call them through \`lib/api/client.ts\`; request and response types are in \`lib/api/contracts.ts\`

---

## Future Considerations

1. **Dark Mode**: CSS variables are prepared for theme switching
2. **Offline Support**: Service worker for offline reading
3. **Reading Statistics**: Track time spent, pages read
4. **Swipe Gestures**: Swipe left/right for page navigation
5. **Bookshelf Organization**: Favorites, reading, completed categories
