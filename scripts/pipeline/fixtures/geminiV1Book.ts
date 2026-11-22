/**
 * A Gemini book main's pipeline stopped in chunk 4 of 4: three chunks appended to both outputs,
 * after '\n\n'. The reader file is main's real output (fake replies, real alignRephrase and
 * MeCab): alignRephrase gives each sentence its own head, not each source line. The replies are
 * main's -rephrase.txt with one head reworded, as real Gemini replies often are; the reader
 * file has the source sentence back in its place.
 */
/** The --chunk-size the book was split with. */
export const GEMINI_CHUNK_SIZE = 40;

export const GEMINI_CHUNKS = [
  '朝の駅はいつも混んでいた。彼は人の波をかき分けて改札を抜けた。',
  '\n会社に着くと、机の上に手紙が置いてあった。差出人の名前はなかった。',
  '\n昼休みに手紙を開けてみた。中には短い言葉が一行だけ書かれていた。',
  '\n「明日の朝、同じ駅で待っています。」彼は少し考えてから手紙をしまった。',
];

export const GEMINI_REPLIES = [
  '< 朝の駅はいつも混んでいた。\n>> やさしく: 朝の駅はいつも混\n\n< 彼は人の波をかき分けて改札を抜けた。\n>> やさしく: 彼は人の波をかき',
  '< 会社に着くと、机の上に手紙が置いてあった。\n>> やさしく: 会社に着くと、机\n\n< 差出人の名はなかった。\n>> やさしく: 差出人の名前はな',
  '< 昼休みに手紙を開けてみた。\n>> やさしく: 昼休みに手紙を開\n\n< 中には短い言葉が一行だけ書かれていた。\n>> やさしく: 中には短い言葉が',
];

export const GEMINI_READER_CHUNKS = [
  '< <ruby>朝<rt>あさ</rt></ruby>の<ruby>駅<rt>えき</rt></ruby>はいつも<ruby>混ん<rt>こん</rt></ruby>でいた。\r\n'
    + '>> やさしく:<ruby>朝<rt>あさ</rt></ruby>の<ruby>駅<rt>えき</rt></ruby>はいつも<ruby>混<rt>こん</rt></ruby>\r\n\r\n'
    + '< <ruby>彼<rt>かれ</rt></ruby>は<ruby>人<rt>ひと</rt></ruby>の<ruby>波<rt>なみ</rt></ruby>を<ruby>かき分け<rt>かきわけ</rt></ruby>て'
    + '<ruby>改札<rt>かいさつ</rt></ruby>を<ruby>抜け<rt>ぬけ</rt></ruby>た。\r\n'
    + '>> やさしく:<ruby>彼<rt>かれ</rt></ruby>は<ruby>人<rt>ひと</rt></ruby>の<ruby>波<rt>なみ</rt></ruby>をかき',
  '< <ruby>会社<rt>かいしゃ</rt></ruby>に<ruby>着く<rt>つく</rt></ruby>と、<ruby>机<rt>つくえ</rt></ruby>の<ruby>上<rt>うえ</rt></ruby>に'
    + '<ruby>手紙<rt>てがみ</rt></ruby>が<ruby>置い<rt>おい</rt></ruby>てあった。\r\n'
    + '>> やさしく:<ruby>会社<rt>かいしゃ</rt></ruby>に<ruby>着く<rt>つく</rt></ruby>と、<ruby>机<rt>つくえ</rt></ruby>\r\n\r\n'
    + '< <ruby>差出<rt>さしだし</rt></ruby><ruby>人<rt>にん</rt></ruby>の<ruby>名前<rt>なまえ</rt></ruby>はなかった。\r\n'
    + '>> やさしく:<ruby>差出<rt>さしだし</rt></ruby><ruby>人<rt>にん</rt></ruby>の<ruby>名前<rt>なまえ</rt></ruby>はな',
  '< <ruby>昼休み<rt>ひるやすみ</rt></ruby>に<ruby>手紙<rt>てがみ</rt></ruby>を<ruby>開け<rt>あけ</rt></ruby>てみた。\r\n'
    + '>> やさしく:<ruby>昼休み<rt>ひるやすみ</rt></ruby>に<ruby>手紙<rt>てがみ</rt></ruby>を<ruby>開<rt>ひらけ</rt></ruby>\r\n\r\n'
    + '< <ruby>中<rt>なか</rt></ruby>には<ruby>短い<rt>みじかい</rt></ruby><ruby>言葉<rt>ことば</rt></ruby>が<ruby>一行<rt>いっこう</rt></ruby>だけ'
    + '<ruby>書か<rt>かか</rt></ruby>れていた。\r\n'
    + '>> やさしく:<ruby>中<rt>なか</rt></ruby>には<ruby>短い<rt>みじかい</rt></ruby><ruby>言葉<rt>ことば</rt></ruby>が',
];

/**
 * The same three chunks when Gemini reworded chunk 2's second head too far for alignRephrase to
 * put the source back: the old run logged it as unmatched and kept Gemini's wording in the reader
 * file (real alignRephrase and MeCab), so the < lines no longer hold the source text.
 */
export const GEMINI_REPLIES_WITH_UNMATCHED_HEAD = [
  GEMINI_REPLIES[0],
  '< 会社に着くと、机の上に手紙が置いてあった。\n>> やさしく: 会社に着くと、机\n\n< 手紙には誰の名前も書かれていなかった。\n>> やさしく: 差出人の名前はな',
  GEMINI_REPLIES[2],
];

export const GEMINI_READER_CHUNKS_WITH_UNMATCHED_HEAD = [
  GEMINI_READER_CHUNKS[0],
  '< <ruby>会社<rt>かいしゃ</rt></ruby>に<ruby>着く<rt>つく</rt></ruby>と、<ruby>机<rt>つくえ</rt></ruby>の<ruby>上<rt>うえ</rt></ruby>に'
    + '<ruby>手紙<rt>てがみ</rt></ruby>が<ruby>置い<rt>おい</rt></ruby>てあった。\r\n'
    + '>> やさしく:<ruby>会社<rt>かいしゃ</rt></ruby>に<ruby>着く<rt>つく</rt></ruby>と、<ruby>机<rt>つくえ</rt></ruby>\r\n\r\n'
    + '< <ruby>手紙<rt>てがみ</rt></ruby>には<ruby>誰<rt>だれ</rt></ruby>の<ruby>名前<rt>なまえ</rt></ruby>も<ruby>書か<rt>かか</rt></ruby>れていなかった。\r\n'
    + '>> やさしく:<ruby>差出<rt>さしだし</rt></ruby><ruby>人<rt>にん</rt></ruby>の<ruby>名前<rt>なまえ</rt></ruby>はな',
  GEMINI_READER_CHUNKS[2],
];
