'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { COLORS, THEME } from '@/lib/constants';
import { toTint } from '@/lib/utils/colorTint';
import FabIcon, { type FabIconName } from './FabIcon';

export interface FabAction {
  id: string;
  icon: FabIconName;
  label: string;
  onSelect: () => void;
  active?: boolean;
  keepMenuOpen?: boolean;
  beta?: boolean;
}

interface ReaderFABProps {
  actions: FabAction[];
}

const STORAGE_KEY = 'fab_position';
const FAB_SIZE = 52;
const MENU_MARGIN = 10;

interface Position {
  x: number;
  y: number;
}

function getInitialPosition(): Position {
  if (typeof window === 'undefined') {
    return { x: 20, y: 80 };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const pos = JSON.parse(stored);
      return {
        x: Math.min(Math.max(0, pos.x), window.innerWidth - FAB_SIZE),
        y: Math.min(Math.max(0, pos.y), window.innerHeight - FAB_SIZE),
      };
    }
  } catch {}

  return {
    x: window.innerWidth - FAB_SIZE - 20,
    y: window.innerHeight - FAB_SIZE - 80,
  };
}

export default function ReaderFAB({ actions }: ReaderFABProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [position, setPosition] = useState<Position>({ x: 20, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const [mounted, setMounted] = useState(false);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    hasMoved: boolean;
  } | null>(null);

  const justDraggedRef = useRef(false);
  const fabRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setPosition(getInitialPosition());
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isDragging) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
      } catch {}
    }
  }, [position, isDragging, mounted]);

  const handleDragStart = useCallback((clientX: number, clientY: number) => {
    dragRef.current = {
      startX: clientX,
      startY: clientY,
      initialX: position.x,
      initialY: position.y,
      hasMoved: false,
    };
    setIsDragging(true);
  }, [position]);

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    if (!dragRef.current) return;

    const deltaX = clientX - dragRef.current.startX;
    const deltaY = clientY - dragRef.current.startY;

    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      dragRef.current.hasMoved = true;
    }

    if (dragRef.current.hasMoved) {
      const newX = Math.min(
        Math.max(0, dragRef.current.initialX + deltaX),
        window.innerWidth - FAB_SIZE
      );
      const newY = Math.min(
        Math.max(0, dragRef.current.initialY + deltaY),
        window.innerHeight - FAB_SIZE
      );

      setPosition({ x: newX, y: newY });
    }
  }, []);

  const handleDragEnd = useCallback(() => {
    const wasDragging = dragRef.current?.hasMoved;
    dragRef.current = null;
    setIsDragging(false);

    if (wasDragging) {
      justDraggedRef.current = true;
      setTimeout(() => {
        justDraggedRef.current = false;
      }, 100);
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    handleDragStart(e.clientX, e.clientY);
  }, [handleDragStart]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleDragMove(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      handleDragEnd();
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleDragMove, handleDragEnd]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleDragStart(touch.clientX, touch.clientY);
  }, [handleDragStart]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    handleDragMove(touch.clientX, touch.clientY);
  }, [handleDragMove]);

  const handleTouchEnd = useCallback(() => {
    handleDragEnd();
  }, [handleDragEnd]);

  const handleFabClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (dragRef.current?.hasMoved || justDraggedRef.current) return;
    setIsExpanded(prev => !prev);
  }, []);

  const handleAction = useCallback((action: FabAction) => {
    action.onSelect();
    if (action.keepMenuOpen) return;
    setIsExpanded(false);
  }, []);

  const getMenuPosition = useCallback(() => {
    if (typeof window === 'undefined') return { bottom: '64px', right: '0' };

    const isNearBottom = position.y > window.innerHeight / 2;
    const isNearRight = position.x > window.innerWidth / 2;

    return {
      ...(isNearBottom ? { bottom: `${FAB_SIZE + MENU_MARGIN}px` } : { top: `${FAB_SIZE + MENU_MARGIN}px` }),
      ...(isNearRight ? { right: '0' } : { left: '0' }),
    };
  }, [position]);

  const menuStyle = getMenuPosition();
  const isMenuAbove = 'bottom' in menuStyle;

  if (!mounted) return null;

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
                    {action.beta && (
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5"
                        style={{ backgroundColor: COLORS.START_CURSOR, color: COLORS.SURFACE, letterSpacing: '0.5px' }}
                      >
                        BETA
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            ref={fabRef}
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
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
