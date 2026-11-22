#!/usr/bin/env python3
"""
EPUB to Text with Furigana Converter

Converts EPUB files to plain text while:
1. Preserving existing furigana (ruby tags) from the EPUB
2. Adding furigana to remaining kanji without it
3. Optional N3+ kanji filtering

Usage:
    python epub-to-text-furigana.py book.epub
    python epub-to-text-furigana.py book.epub --filter n3

Progress goes to stderr. The last line on stdout is the result as JSON:
    {"bookName": ..., "textPath": ..., "metadataPath": ...}
"""

import argparse
import json
import re
import sys
from pathlib import Path


# Progress goes to stderr so stdout carries only the result the pipeline reads.
def log(*args, **kwargs):
    print(*args, file=sys.stderr, **kwargs)


try:
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup
except ImportError as e:
    log(f"Error: Missing required dependencies: {e}")
    log("\nPlease install dependencies:")
    log("  pip install -r scripts/requirements.txt")
    log("\nOr install individually:")
    log("  pip install ebooklib beautifulsoup4 lxml mecab-python3 unidic-lite")
    sys.exit(1)

# Import local helper module
try:
    from furigana_helper import FuriganaGenerator, preserve_existing_ruby
except ImportError:
    log("Error: Could not find furigana_helper.py")
    log("Make sure you're running this script from the project root or scripts directory.")
    sys.exit(1)


def sanitize_filename(title):
    """Convert book title to safe filename."""
    # Remove or replace invalid filename characters
    safe = re.sub(r'[<>:"/\\|?*]', '', title)
    # Replace multiple spaces with single space
    safe = re.sub(r'\s+', ' ', safe)
    # Trim and limit length
    safe = safe.strip()[:200]
    return safe if safe else 'untitled'


def extract_images_from_epub(book, output_dir, safe_title):
    """
    Extract all images from EPUB and save them to the output directory.

    Args:
        book: EPUB book object
        output_dir: Directory to save images
        safe_title: Sanitized book title for creating subdirectory

    Returns:
        List of dicts with image metadata: [
            {'fileName': 'illustration-001.jpg', 'imagePath': '/public/...', 'orderIndex': 0, ...}
        ]
    """
    images_dir = output_dir / safe_title / 'images'
    images_dir.mkdir(parents=True, exist_ok=True)

    image_metadata = []
    image_counter = 0
    failed_images = []

    # Count total images first for validation
    all_images = [item for item in book.get_items() if item.get_type() == ebooklib.ITEM_IMAGE]
    total_images = len(all_images)
    log(f"  Found {total_images} images via ITEM_IMAGE filter")

    # Check for cover image specifically
    # Method 1: Look for 'cover' in filename among ITEM_IMAGE items
    cover_image = None
    for item in all_images:
        original_name = item.get_name()
        if 'cover' in original_name.lower():
            cover_image = item
            log(f"  [COVER] Detected cover image in ITEM_IMAGE: {original_name}")
            break

    # Method 2: If not found, check all items (including non-ITEM_IMAGE)
    if not cover_image:
        log(f"  [SEARCH] Cover not in ITEM_IMAGE list, checking all items...")
        for item in book.get_items():
            original_name = item.get_name()
            if 'cover' in original_name.lower() and (original_name.endswith('.jpg') or
                                                       original_name.endswith('.jpeg') or
                                                       original_name.endswith('.png')):
                cover_image = item
                total_images += 1  # Add to count since it wasn't in ITEM_IMAGE
                log(f"  [COVER] Detected cover image in all items: {original_name}")
                break

    # Extract cover first with index 000 if found
    if cover_image:
        original_name = cover_image.get_name()
        ext = Path(original_name).suffix or '.jpg'
        new_filename = f"illustration-000{ext}"
        image_path = images_dir / new_filename

        log(f"  Processing: {original_name} → {new_filename}")
        try:
            with open(image_path, 'wb') as img_file:
                img_file.write(cover_image.get_content())

            image_metadata.append({
                'fileName': new_filename,
                'imagePath': str(image_path),
                'orderIndex': -1,
                'originalName': original_name,
                'altText': None
            })
            log(f"  [OK] Extracted: {new_filename}")
        except Exception as e:
            log(f"  [FAIL] ERROR saving cover image {original_name}:")
            log(f"     Exception: {type(e).__name__}: {e}")
            failed_images.append(original_name)

    # Extract remaining images
    for item in all_images:
        if cover_image and item == cover_image:
            continue  # Skip cover, already processed

        original_name = item.get_name()
        ext = Path(original_name).suffix or '.jpg'

        image_counter += 1
        new_filename = f"illustration-{image_counter:03d}{ext}"
        image_path = images_dir / new_filename

        log(f"  Processing: {original_name} → {new_filename}")
        try:
            with open(image_path, 'wb') as img_file:
                img_file.write(item.get_content())

            image_metadata.append({
                'fileName': new_filename,
                'imagePath': str(image_path),
                'orderIndex': image_counter - 1,
                'originalName': original_name,
                'altText': None
            })
            log(f"  [OK] Extracted: {new_filename}")
        except Exception as e:
            log(f"  [FAIL] ERROR saving image {original_name}:")
            log(f"     Exception: {type(e).__name__}: {e}")
            failed_images.append(original_name)

    # Validation
    log(f"\n  Summary:")
    log(f"    Total images in EPUB: {total_images}")
    log(f"    Successfully extracted: {len(image_metadata)}")
    if failed_images:
        log(f"    [WARN]  Failed to extract: {len(failed_images)}")
        for img in failed_images:
            log(f"       - {img}")
    if len(image_metadata) < total_images:
        log(f"    [WARN]  WARNING: {total_images - len(image_metadata)} image(s) missing!")

    return image_metadata


def extract_text_from_html(html_content):
    """
    Extract text content from HTML, preserving only ruby tags.
    Note: Most processing is now done in preserve_existing_ruby().
    This function just does basic cleanup.
    """
    # Just return the HTML content - preserve_existing_ruby() will handle extraction
    return html_content


def process_epub_to_text(epub_path, filter_n3_plus=False, output_dir=None, preserve_long_vowel=False):
    """
    Convert EPUB to text file with furigana.

    Args:
        epub_path: Path to EPUB file
        filter_n3_plus: If True, only add furigana to N3+ kanji
        output_dir: Directory to save output file (default: public/bookv2-furigana/)
        preserve_long_vowel: If True, keep ー in output. If False (default), convert to proper vowels.

    Returns:
        Dict with the book folder name (bookName) and the paths of the text and metadata files
    """
    log(f"Processing EPUB: {epub_path}")
    log(f"Filtering mode: {'N3+ only' if filter_n3_plus else 'All kanji'}")
    log(f"Hiragana style: {'Long vowel marks (ー)' if preserve_long_vowel else 'Full hiragana (proper)'}")

    # Read EPUB
    try:
        book = epub.read_epub(epub_path)
    except Exception as e:
        log(f"Error reading EPUB: {e}")
        sys.exit(1)

    # Get book metadata
    title = book.get_metadata('DC', 'title')
    title = title[0][0] if title else Path(epub_path).stem
    author = book.get_metadata('DC', 'creator')
    author = author[0][0] if author else 'Unknown'

    log(f"Title: {title}")
    log(f"Author: {author}")

    # Create output filename and directory structure
    safe_title = sanitize_filename(title)
    if output_dir is None:
        script_dir = Path(__file__).parent
        project_root = script_dir.parent
        output_dir = project_root / 'public' / 'bookv2-furigana'
    output_dir = Path(output_dir)

    # Extract images first
    log(f"\n{'='*60}")
    log("Extracting images from EPUB...")
    log(f"{'='*60}")
    image_metadata = extract_images_from_epub(book, output_dir, safe_title)
    log(f"  Extracted {len(image_metadata)} images")

    # PASS 1: Extract name dictionary from existing ruby tags
    log("\nPass 1: Building name/term dictionary from EPUB...")
    from furigana_helper import extract_ruby_dictionary

    name_dictionary = {}
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            try:
                html_content = item.get_content().decode('utf-8')
                chapter_dict = extract_ruby_dictionary(html_content)
                name_dictionary.update(chapter_dict)
            except Exception:
                # Skip chapters that fail to parse
                continue

    log(f"  Found {len(name_dictionary)} unique names/terms with furigana")
    if name_dictionary:
        # Show a few examples
        sample = list(name_dictionary.items())[:5]
        for kanji, reading in sample:
            log(f"    {kanji} → {reading}")

    # Initialize furigana generator with name dictionary and hiragana style
    log("\nPass 2: Initializing MeCab and processing chapters...")
    try:
        generator = FuriganaGenerator(
            name_dictionary=name_dictionary,
            preserve_long_vowel=preserve_long_vowel
        )
    except RuntimeError as e:
        log(f"Error: {e}")
        sys.exit(1)

    # Process chapters
    log("\nExtracting chapters...")
    chapters = []
    chapter_count = 0

    # Get all items in reading order (spine)
    for spine_id, linear in book.spine:
        item = book.get_item_with_id(spine_id)
        if item and item.get_type() == ebooklib.ITEM_DOCUMENT:
            chapter_count += 1
            log(f"  Processing chapter {chapter_count}...", end='', flush=True)

            try:
                # Get HTML content
                html_content = item.get_content().decode('utf-8')

                # Extract text while preserving ruby tags
                text_with_ruby = extract_text_from_html(html_content)

                # Add furigana to text that doesn't have it
                # This preserves existing ruby tags and adds new ones
                processed = preserve_existing_ruby(
                    text_with_ruby,
                    generator,
                    filter_n3_plus
                )

                # Clean up excessive whitespace and metadata
                processed = re.sub(r'\n{3,}', '\n\n', processed)

                # Remove XML/HTML declarations and other metadata
                processed = re.sub(r"xmlversion.*?html", "", processed)
                processed = re.sub(r'<\?xml.*?\?>', '', processed)
                processed = re.sub(r'<!DOCTYPE.*?>', '', processed)

                processed = processed.strip()

                # Only add non-empty chapters with actual content
                if processed and len(processed) > 10:  # Ignore nearly-empty chapters
                    chapters.append(processed)
                    log(" [OK]")
                else:
                    log(" (empty, skipped)")

            except Exception as e:
                log(f" [FAIL] Error: {e}")
                # Continue processing other chapters
                continue

    if not chapters:
        log("\nError: No chapters could be extracted from the EPUB.")
        sys.exit(1)

    log(f"\nSuccessfully processed {len(chapters)} chapters")

    # Combine chapters
    log("Combining chapters...")
    output_text = f"Title: {title}\nAuthor: {author}\n\n"
    output_text += "\n\n".join(chapters)

    # Create book directory structure (book-specific folder)
    book_dir = output_dir / safe_title
    book_dir.mkdir(parents=True, exist_ok=True)

    # Create output paths inside book directory
    output_path = book_dir / f"{safe_title}.txt"
    metadata_path = book_dir / f"{safe_title}.json"

    # Save text file
    log(f"\nSaving text to: {output_path}")
    try:
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write(output_text)
    except Exception as e:
        log(f"Error saving file: {e}")
        sys.exit(1)

    # Calculate file size
    file_size = output_path.stat().st_size / 1024  # KB

    # Create metadata JSON
    metadata = {
        'title': title,
        'author': author,
        'fileName': safe_title,
        'textFilePath': str(output_path),
        'originalEpubName': Path(epub_path).name,
        'processingHistory': {
            'filterMode': 'n3' if filter_n3_plus else 'all',
            'hiraganaStyle': 'long-vowel' if preserve_long_vowel else 'full',
            'chaptersCount': len(chapters),
            'fileSize': int(file_size),
            'imageCount': len(image_metadata)
        },
        'images': image_metadata
    }

    # Save metadata JSON
    log(f"Saving metadata to: {metadata_path}")
    try:
        with open(metadata_path, 'w', encoding='utf-8') as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f"Error saving metadata: {e}")
        sys.exit(1)

    # Print summary
    log(f"\n{'='*60}")
    log(f"[OK] Conversion complete!")
    log(f"{'='*60}")
    log(f"Output file: {output_path}")
    log(f"Metadata: {metadata_path}")
    log(f"File size: {file_size:.1f} KB")
    log(f"Chapters: {len(chapters)}")
    log(f"Images: {len(image_metadata)}")
    log(f"Filter mode: {'N3+ kanji only' if filter_n3_plus else 'All kanji'}")
    log(f"Hiragana style: {'Long vowel marks (ー)' if preserve_long_vowel else 'Full hiragana (proper)'}")
    log(f"{'='*60}")

    return {'bookName': safe_title, 'textPath': str(output_path), 'metadataPath': str(metadata_path)}


def main():
    """Main entry point for command-line usage."""
    parser = argparse.ArgumentParser(
        description='Convert EPUB to text with furigana',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Add furigana to all kanji (default)
  python epub-to-text-furigana.py book.epub

  # Only add furigana to N3+ kanji (advanced/rare kanji)
  python epub-to-text-furigana.py book.epub --filter n3

  # Specify custom output directory
  python epub-to-text-furigana.py book.epub --output ./output/

Note: Existing furigana in the EPUB will always be preserved.
        """
    )

    parser.add_argument(
        'epub_file',
        help='Path to EPUB file to convert'
    )

    parser.add_argument(
        '--filter',
        choices=['n3', 'none'],
        default='none',
        help='Furigana filtering mode (default: none - add to all kanji)'
    )

    parser.add_argument(
        '--output',
        '-o',
        help='Output directory (default: public/bookv2-furigana/)'
    )

    parser.add_argument(
        '--hiragana-style',
        choices=['full', 'long-vowel'],
        default='full',
        help='Hiragana style: "full" (しょう) or "long-vowel" (しょー) (default: full)'
    )

    args = parser.parse_args()

    # Validate input file
    epub_path = Path(args.epub_file)
    if not epub_path.exists():
        log(f"Error: File not found: {epub_path}")
        sys.exit(1)

    if not epub_path.suffix.lower() == '.epub':
        log(f"Warning: File doesn't have .epub extension: {epub_path}")
        log("Continue anyway? (y/n): ", end='', flush=True)
        if sys.stdin.readline().strip().lower() != 'y':
            sys.exit(0)

    # Process the EPUB
    filter_n3_plus = (args.filter == 'n3')
    preserve_long_vowel = (args.hiragana_style == 'long-vowel')

    result = process_epub_to_text(
        epub_path,
        filter_n3_plus=filter_n3_plus,
        output_dir=args.output,
        preserve_long_vowel=preserve_long_vowel
    )

    log("\n[OK] Done! You can now use this file in your Japanese reading app.")
    log(f"  File saved to: {result['textPath']}")
    print(json.dumps(result))


if __name__ == '__main__':
    main()
