#!/usr/bin/env python3
"""
Writes a two-chapter EPUB with ruby, a cover and one illustration, for the tests of the
pipeline's Python steps.

Usage:
    python make-tiny-epub.py <out.epub> <title>
"""

import sys

from ebooklib import epub

# A 1x1 transparent PNG.
PNG_BYTES = bytes.fromhex(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489'
    '0000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082'
)

CHAPTERS = [
    (
        'ch1.xhtml',
        '<p><ruby>吾輩<rt>わがはい</rt></ruby>は猫である。名前はまだ無い。</p>'
        '<p><ruby>東<rt>ひがし</rt></ruby><ruby>京<rt>きょう</rt></ruby>まで<ruby>歩<rt>ある</rt></ruby>く。</p>'
        '<p><img src="images/fig1.png" alt=""/></p>',
    ),
    (
        'ch2.xhtml',
        '<p>どこで生れたかとんと見当がつかぬ。何でも薄暗いじめじめした所で泣いていた事だけは記憶している。</p>',
    ),
]


def main():
    out_path, title = sys.argv[1], sys.argv[2]
    book = epub.EpubBook()
    book.set_identifier('tiny-book')
    book.set_title(title)
    book.set_language('ja')
    book.add_author('試験 太郎')
    book.add_item(epub.EpubImage(uid='cover', file_name='images/cover.png', media_type='image/png', content=PNG_BYTES))
    book.add_item(epub.EpubImage(uid='fig1', file_name='images/fig1.png', media_type='image/png', content=PNG_BYTES))

    chapters = []
    for file_name, body in CHAPTERS:
        chapter = epub.EpubHtml(title=file_name, file_name=file_name, lang='ja')
        chapter.content = f'<html><body>{body}</body></html>'
        book.add_item(chapter)
        chapters.append(chapter)

    book.toc = chapters
    book.spine = chapters
    book.add_item(epub.EpubNcx())
    book.add_item(epub.EpubNav())
    epub.write_epub(out_path, book)


if __name__ == '__main__':
    main()
