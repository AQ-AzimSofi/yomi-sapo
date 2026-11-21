'use client';

import { useState, useCallback } from 'react';
import { STORAGE_KEYS, THEME } from '@/lib/constants';
import { toTint } from '@/lib/utils/colorTint';
import type { Point, Size } from '@/lib/utils/draggablePosition';
import { useDraggablePosition } from '@/app/hooks/useDraggablePosition';
import FabIcon, { type FabIconName } from './FabIcon';

export interface FabAction {
  id: string;
  icon: FabIconName;
  label: string;
  onSelect: () => void;
  active?: boolean;
  keepMenuOpen?: boolean;
}

interface ReaderFABProps {
  actions: FabAction[];
}

const FAB_SIZE = 52;
const FAB_BOX: Size = { width: FAB_SIZE, height: FAB_SIZE };
const MENU_MARGIN = 10;

function defaultFabPosition(viewport: Size): Point {
  return { x: viewport.width - FAB_SIZE - 20, y: viewport.height - FAB_SIZE - 80 };
}

/** Opens the menu toward the middle of the screen, away from the edges the button is near. */
function menuPlacement(position: Point) {
  const isNearBottom = position.y > window.innerHeight / 2;
  const isNearRight = position.x > window.innerWidth / 2;

  return {
    ...(isNearBottom ? { bottom: `${FAB_SIZE + MENU_MARGIN}px` } : { top: `${FAB_SIZE + MENU_MARGIN}px` }),
    ...(isNearRight ? { right: '0' } : { left: '0' }),
  };
}

export default function ReaderFAB({ actions }: ReaderFABProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const { position, isDragging, dragHandlers, isClickFromDrag } = useDraggablePosition({
    storageKey: STORAGE_KEYS.FAB_POSITION,
    size: FAB_BOX,
    defaultPosition: defaultFabPosition,
  });

  const handleFabClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isClickFromDrag()) return;
    setIsExpanded(prev => !prev);
  }, [isClickFromDrag]);

  const handleAction = useCallback((action: FabAction) => {
    action.onSelect();
    if (action.keepMenuOpen) return;
    setIsExpanded(false);
  }, []);

  if (!position) return null;

  const menuStyle = menuPlacement(position);
  const isMenuAbove = 'bottom' in menuStyle;
  const activeBg = toTint(THEME.PRIMARY, 12);

  return (
    <>
      {isExpanded && (
        <div
          className="fixed inset-0 z-[9998]"
          onClick={() => setIsExpanded(false)}
          style={{ backgroundColor: THEME.FAB_SCRIM }}
        />
      )}

      <div
        style={{
          position: 'fixed',
          left: `${position.x}px`,
          top: `${position.y}px`,
          zIndex: 9999,
          touchAction: 'none',
        }}
      >
        <div className="relative">
          {isExpanded && (
            <div
              className="absolute"
              style={{
                ...menuStyle,
                display: 'flex',
                flexDirection: isMenuAbove ? 'column-reverse' : 'column',
              }}
            >
              <div
                style={{
                  backgroundColor: THEME.SURFACE,
                  border: `1px solid ${THEME.INK}`,
                  boxShadow: THEME.SHADOW_MENU,
                  overflow: 'hidden',
                  minWidth: '180px',
                  animation: 'fab-menu-enter 200ms ease-out',
                }}
              >
                {actions.map((action, index) => (
                  <button
                    key={action.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAction(action);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 font-gothic interactive-nav-btn"
                    style={{
                      backgroundColor: action.active ? activeBg : 'transparent',
                      color: action.active ? THEME.PRIMARY : THEME.INK,
                      borderBottom: index < actions.length - 1 ? `1px solid ${THEME.NEUTRAL}` : 'none',
                    }}
                  >
                    <span className="flex items-center justify-center w-5 h-5 flex-shrink-0">
                      <FabIcon name={action.icon} />
                    </span>
                    <span className="text-[13px] font-medium whitespace-nowrap">{action.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            {...dragHandlers}
            onClick={handleFabClick}
            aria-label="読書メニュー"
            aria-expanded={isExpanded}
            className="relative select-none flex items-center justify-center"
            style={{
              width: `${FAB_SIZE}px`,
              height: `${FAB_SIZE}px`,
              backgroundColor: THEME.INK,
              color: THEME.ON_INK,
              border: 'none',
              boxShadow: isDragging ? THEME.SHADOW_FAB_LIFTED : THEME.SHADOW_FAB,
              cursor: isDragging ? 'grabbing' : 'grab',
              transition: isDragging ? 'none' : 'color 200ms, box-shadow 200ms, transform 200ms',
              transform: isDragging ? 'scale(1.06)' : 'scale(1)',
            }}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              style={{
                transition: 'transform 200ms ease-out',
                transform: isExpanded ? 'rotate(45deg)' : 'rotate(0deg)',
              }}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes fab-menu-enter {
          from {
            opacity: 0;
            transform: scale(0.95) translateY(4px);
          }
          to {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </>
  );
}
