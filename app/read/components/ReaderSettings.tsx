'use client';

import { READER_CONFIG } from '@/lib/constants';
import { usePreference } from '@/app/hooks/usePreference';
import { READER_PREFERENCES } from '../readerPreferences';

function sliderGradient(value: number, min: number, max: number): string {
  const percent = ((value - min) / (max - min)) * 100;
  return `linear-gradient(to right, var(--range-fill) 0%, var(--range-fill) ${percent}%, var(--range-track) ${percent}%, var(--range-track) 100%)`;
}

export default function ReaderSettings() {
  const [fontSize, setFontSize] = usePreference(READER_PREFERENCES.fontSize);
  const [lineHeight, setLineHeight] = usePreference(READER_PREFERENCES.lineHeight);
  const [aiExplanationEnabled, setAiExplanationEnabled] = usePreference(READER_PREFERENCES.aiExplanationEnabled);
  const [audiobookEnabled, setAudiobookEnabled] = usePreference(READER_PREFERENCES.audiobookEnabled);

  return (
    <div className="space-y-6">
      <div>
        <label className="settings-label font-bold">Font Size</label>
        <div className="flex items-center gap-4 mt-3">
          <span className="settings-sublabel" style={{ fontSize: '14px' }}>A</span>
          <input
            type="range"
            min={READER_CONFIG.MIN_FONT_SIZE}
            max={READER_CONFIG.MAX_FONT_SIZE}
            value={fontSize}
            onChange={(e) => setFontSize(Number(e.target.value))}
            className="flex-1"
            style={{
              background: sliderGradient(fontSize, READER_CONFIG.MIN_FONT_SIZE, READER_CONFIG.MAX_FONT_SIZE),
            }}
          />
          <span className="settings-sublabel" style={{ fontSize: '20px' }}>A</span>
        </div>
      </div>

      <div>
        <label className="settings-label font-bold">Line Height</label>
        <div className="flex items-center gap-4 mt-3">
          <span className="settings-sublabel">Compact</span>
          <input
            type="range"
            min={READER_CONFIG.MIN_LINE_HEIGHT * 10}
            max={READER_CONFIG.MAX_LINE_HEIGHT * 10}
            value={lineHeight * 10}
            onChange={(e) => setLineHeight(Number(e.target.value) / 10)}
            className="flex-1"
            style={{
              background: sliderGradient(
                lineHeight * 10,
                READER_CONFIG.MIN_LINE_HEIGHT * 10,
                READER_CONFIG.MAX_LINE_HEIGHT * 10
              ),
            }}
          />
          <span className="settings-sublabel">Spacious</span>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-label">AI Explanation</div>
            <div className="settings-sublabel">Tap text for AI analysis</div>
          </div>
          <button
            className={`apple-toggle ${aiExplanationEnabled ? 'on' : ''}`}
            onClick={() => setAiExplanationEnabled(!aiExplanationEnabled)}
          >
            <span className="thumb" />
          </button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-label">Audiobook</div>
            <div className="settings-sublabel">Read sentences aloud with a player</div>
          </div>
          <button
            className={`apple-toggle ${audiobookEnabled ? 'on' : ''}`}
            onClick={() => setAudiobookEnabled(!audiobookEnabled)}
          >
            <span className="thumb" />
          </button>
        </div>
      </div>
    </div>
  );
}
