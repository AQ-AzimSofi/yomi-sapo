'use client';

import { useState, useEffect } from 'react';
import { COLORS, THEME } from '@/lib/constants';

interface CopyRangeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCopy: (fromPage: number, toPage: number) => void;
  currentPage: number;
  totalPages: number;
  copyFeedback: boolean;
}

export default function CopyRangeModal({
  isOpen,
  onClose,
  onCopy,
  currentPage,
  totalPages,
  copyFeedback,
}: CopyRangeModalProps) {
  const [fromPage, setFromPage] = useState(currentPage);
  const [toPage, setToPage] = useState(currentPage);

  useEffect(() => {
    if (isOpen) {
      setFromPage(currentPage);
      setToPage(Math.min(currentPage + 4, totalPages));
    }
  }, [isOpen, currentPage, totalPages]);

  const isValid = fromPage >= 1 && toPage >= fromPage && toPage <= totalPages;

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      onClick={onClose}
      style={{ backgroundColor: THEME.SCRIM }}
    >
      <div
        className="p-5 w-[280px]"
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: THEME.SURFACE,
          border: `1px solid ${THEME.INK}`,
        }}
      >
        <h3
          className="font-mincho font-bold text-[17px] tracking-[0.04em] mb-4"
          style={{ color: THEME.INK }}
        >
          範囲をコピー
        </h3>

        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1">
            <label
              className="text-[11px] font-medium mb-1 block"
              style={{ color: THEME.SECONDARY }}
            >
              開始ページ
            </label>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={fromPage}
              onChange={(e) => setFromPage(Math.max(1, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2 text-[14px] text-center focus:outline-2"
              style={{
                backgroundColor: THEME.FIELD,
                color: THEME.INK,
                border: `1px solid ${THEME.NEUTRAL}`,
                outlineColor: THEME.PRIMARY,
              }}
            />
          </div>
          <span
            className="text-[13px] mt-4"
            style={{ color: THEME.SECONDARY }}
          >
            〜
          </span>
          <div className="flex-1">
            <label
              className="text-[11px] font-medium mb-1 block"
              style={{ color: THEME.SECONDARY }}
            >
              終了ページ
            </label>
            <input
              type="number"
              min={1}
              max={totalPages}
              value={toPage}
              onChange={(e) => setToPage(Math.min(totalPages, parseInt(e.target.value) || 1))}
              className="w-full px-3 py-2 text-[14px] text-center focus:outline-2"
              style={{
                backgroundColor: THEME.FIELD,
                color: THEME.INK,
                border: `1px solid ${THEME.NEUTRAL}`,
                outlineColor: THEME.PRIMARY,
              }}
            />
          </div>
        </div>

        <p
          className="text-[11px] mb-4"
          style={{ color: THEME.SECONDARY }}
        >
          {isValid ? `${toPage - fromPage + 1}ページ` : 'ページの範囲が正しくありません'}
        </p>

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 min-h-11 px-3 text-sm font-bold interactive-page-btn"
            style={{
              backgroundColor: 'transparent',
              border: `1px solid ${THEME.NEUTRAL}`,
              color: THEME.INK,
            }}
          >
            キャンセル
          </button>
          <button
            onClick={() => isValid && onCopy(fromPage, toPage)}
            disabled={!isValid}
            className="flex-1 min-h-11 px-3 text-sm font-bold disabled:opacity-30 interactive-btn"
            style={{
              backgroundColor: copyFeedback ? COLORS.SUCCESS : THEME.PRIMARY,
              color: copyFeedback ? COLORS.SURFACE : THEME.ON_PRIMARY,
            }}
          >
            {copyFeedback ? 'コピーしました' : 'コピー'}
          </button>
        </div>
      </div>
    </div>
  );
}
