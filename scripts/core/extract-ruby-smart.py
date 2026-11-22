#!/usr/bin/env python3
"""
Smart Ruby Extraction from EPUB (v2 Optimized)

Extracts vocabulary (words) from EPUB ruby annotations using linguistically-aware heuristics.
Improvements:
- Cleaned Okurigana list for better verb/adjective detection
- Fixed "Volitional Form" bug (e.g., 行こう vs 行こ)
- Added cleanup for full-width spaces

Usage:
    python extract-ruby-smart.py <book.epub> --out <book folder>/ruby-registry.json

The registry's bookTitle is the name of the folder it is written to. Exits non-zero when the
EPUB cannot be read, without writing anything.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from dataclasses import dataclass


# Progress goes to stderr so stdout carries only the result the pipeline reads.
def log(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


try:
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup, NavigableString
    import warnings
    from bs4 import XMLParsedAsHTMLWarning
    warnings.filterwarnings("ignore", category=XMLParsedAsHTMLWarning)
except ImportError as e:
    log(f"Error: Missing dependencies: {e}")
    log("Run: pip install ebooklib beautifulsoup4 lxml")
    sys.exit(1)


KANJI_PATTERN = re.compile(r'[\u4e00-\u9faf\u3400-\u4dbf]')
HIRAGANA_PATTERN = re.compile(r'^[\u3040-\u309F\u30FC]+')
REPETITION_MARK = '々'

# Particles to exclude (single and multi-char)
PARTICLES = {
    'は', 'が', 'を', 'に', 'で', 'と', 'も', 'の', 'へ', 'や',
    'か', 'ね', 'よ', 'わ', 'ば', 'ら', 'ぜ', 'ぞ', 'さ',
    'より', 'から', 'など', 'まで', 'だけ', 'ほど', 'くらい', 'ばかり'
}

# Optimized Okurigana Dictionary
VALID_OKURIGANA = {
    # --- Adjectives (i-adj, na-adj endings) ---
    'しい', 'かい', 'がい', 'さい', 'ない', 'らい', 'ゆい', 'くい', 'ぐい',
    'き', 'け',  # Classical/Literary
    'さ', 'み', 'げ',  # Noun-ifiers

    # --- Verbs (Common Conjugations) ---
    # Dictionary forms (u-verbs)
    'る', 'く', 'ぐ', 'す', 'つ', 'ぬ', 'ぶ', 'む', 'う',
    # Te-forms / Ta-forms
    'った', 'って', 'んだ', 'んで', 'いた', 'いて', 'いだ', 'いで',
    'した', 'して', 'きた', 'きて',
    # Masu stem / Volitional / Potential
    'ます', 'ません', 'ました', 'ましょう',
    'れる', 'られる', 'せる', 'させる',  # Passive/Causative
    'ない', 'なかった', 'なく', 'ず',  # Negative
    'たい', 'たく',  # Desire
    'こう', 'そう', 'よう', 'まい',  # Volitional / Conjectural

    # --- Ichidan / Godan specific tails ---
    'える', 'ける', 'せる', 'てる', 'ねる', 'べる', 'める', 'れる', 'げる', 'でる',
    'いる', 'きる', 'じる', 'ちる', 'にる', 'ひる', 'びる', 'みる', 'りる',
    'わる', 'ある', 'うる', 'おる',

    # --- Single Char Fallbacks (common verb/adj endings) ---
    'い', 'き', 'し', 'ち', 'り', 'え', 'れ',
    'め', 'た', 'て', 'だ', 'で', 'せ', 'べ', 'け', 'げ', 'ね',
    'み', 'ひ', 'び', 'ぎ', 'じ', 'ぴ', 'ぢ',
    'る', 'く', 'ぐ', 'す', 'つ', 'ぬ', 'ぶ', 'む', 'う'  # Dictionary form endings
}


@dataclass
class WordEntry:
    word: str
    reading: str
    source: str = 'epub'
    note: str = ''


def is_all_kanji(text: str) -> bool:
    """Check if text is entirely kanji/repetition marks."""
    if not text:
        return False
    return all(KANJI_PATTERN.match(c) or c == REPETITION_MARK for c in text)


def extract_ruby_base(ruby_tag) -> tuple[str, str]:
    """Extract base text and reading from a ruby tag."""
    if not ruby_tag or not ruby_tag.name == 'ruby':
        return '', ''

    rt = ruby_tag.find('rt')
    if not rt:
        return '', ''

    reading = rt.get_text().strip()

    for rp in ruby_tag.find_all('rp'):
        rp.decompose()

    rt_copy = rt.extract()
    base = ruby_tag.get_text().strip()
    ruby_tag.append(rt_copy)

    return base, reading


def get_next_sibling_ruby(element):
    """Get the next sibling if it's a ruby tag, ignoring whitespace."""
    sibling = element.next_sibling
    while sibling:
        if isinstance(sibling, NavigableString):
            if not sibling.strip():
                sibling = sibling.next_sibling
                continue
            return None
        elif sibling.name == 'ruby':
            return sibling
        else:
            return None
    return None


def get_trailing_text(element) -> str:
    """Get text immediately following an element."""
    sibling = element.next_sibling
    if isinstance(sibling, NavigableString):
        return str(sibling)
    return ''


def extract_words_from_html(html_content: str) -> dict[str, WordEntry]:
    soup = BeautifulSoup(html_content, 'lxml')
    words = {}
    processed_rubies = set()

    rubies = soup.find_all('ruby')

    for ruby in rubies:
        if id(ruby) in processed_rubies:
            continue

        base, reading = extract_ruby_base(ruby)
        if not base or not reading:
            continue

        # Skip entries starting with repetition mark
        if base.startswith(REPETITION_MARK):
            continue

        processed_rubies.add(id(ruby))

        # --- HEURISTIC 1: COMPOUND NOUN MERGE ---
        current_ruby = ruby
        while True:
            next_ruby = get_next_sibling_ruby(current_ruby)
            if not next_ruby:
                break

            next_base, next_reading = extract_ruby_base(next_ruby)

            if is_all_kanji(base) and is_all_kanji(next_base):
                base += next_base
                reading += next_reading
                processed_rubies.add(id(next_ruby))
                current_ruby = next_ruby
            else:
                break

        # --- HEURISTIC 2: OKURIGANA CAPTURE ---
        trailing = get_trailing_text(current_ruby)
        match = HIRAGANA_PATTERN.match(trailing)

        if match:
            okurigana = match.group(0)
            candidate = okurigana[:4]

            found_suffix = ""

            # Try 4, then 3, then 2 chars (longest match first)
            for i in range(min(len(candidate), 4), 1, -1):
                sub = candidate[:i]
                if sub in VALID_OKURIGANA:
                    found_suffix = sub
                    break

            # Fallback: 1 char check
            if not found_suffix and len(candidate) >= 1:
                char = candidate[0]
                if char in VALID_OKURIGANA and char not in PARTICLES:
                    found_suffix = char
                # Special Case: 'う' for volitional (行こう)
                elif char == 'う' and base and base[-1] in ['こ', 'そ', 'よ', 'ろ']:
                    found_suffix = char

            if found_suffix:
                base += found_suffix
                reading += found_suffix

        if base != reading:
            if base not in words:
                words[base] = WordEntry(word=base, reading=reading)

    return words


def build_registry(epub_path: Path, book_title: str) -> dict:
    book = epub.read_epub(str(epub_path))
    all_words = {}

    for spine_id, linear in book.spine:
        item = book.get_item_with_id(spine_id)
        if item and item.get_type() == ebooklib.ITEM_DOCUMENT:
            html = item.get_content().decode('utf-8')
            chapter_words = extract_words_from_html(html)
            all_words.update(chapter_words)

    log(f"  -> Extracted {len(all_words)} unique vocabulary entries")
    entries = [
        {'kanji': all_words[w].word, 'reading': all_words[w].reading, 'source': 'epub_smart', 'note': ''}
        for w in sorted(all_words.keys())
    ]
    return {'bookTitle': book_title, 'entries': entries}


def main():
    parser = argparse.ArgumentParser(description="Build a book's ruby registry (vocabulary index) from its EPUB")
    parser.add_argument('epub_file', help='Path to the EPUB')
    parser.add_argument('--out', required=True, help='ruby-registry.json to write, inside the book folder')
    args = parser.parse_args()

    epub_path = Path(args.epub_file)
    registry_path = Path(args.out)
    log(f"Processing: {epub_path.name}")
    log("Using Smart Extraction: Kanji-Merge + Semantic Okurigana")
    registry = build_registry(epub_path, registry_path.parent.name)

    registry_path.parent.mkdir(parents=True, exist_ok=True)
    with open(registry_path, 'w', encoding='utf-8') as f:
        json.dump(registry, f, ensure_ascii=False, indent=2)
    log(f"  -> Registry written: {registry_path}")


if __name__ == '__main__':
    main()
