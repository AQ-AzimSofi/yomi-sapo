'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clampToViewport,
  parseStoredPosition,
  passesDragThreshold,
  type Point,
  type Size,
} from '@/lib/utils/draggablePosition';

interface DraggablePositionOptions {
  storageKey: string;
  /** The box kept inside the viewport. Pass a module constant so it keeps its identity between renders. */
  size: Size;
  /** Where the element sits until it is first moved. Pass a module-level function for the same reason. */
  defaultPosition: (viewport: Size) => Point;
}

interface DragGesture {
  pointerStart: Point;
  positionStart: Point;
  hasMoved: boolean;
}

// A drag ends with a click on the handle; clicks this soon after it are part of the drag.
const CLICK_AFTER_DRAG_MS = 100;

function viewportSize(): Size {
  return { width: window.innerWidth, height: window.innerHeight };
}

function touchPoint(e: React.TouchEvent): Point {
  const touch = e.touches[0];
  return { x: touch.clientX, y: touch.clientY };
}

/**
 * A position the reader can drag by mouse or touch, kept inside the viewport and
 * saved under storageKey as {"x":..,"y":..}. It is null until mounted, since the
 * saved position and the viewport exist only in the browser.
 */
export function useDraggablePosition({ storageKey, size, defaultPosition }: DraggablePositionOptions) {
  const [position, setPosition] = useState<Point | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const gestureRef = useRef<DragGesture | null>(null);
  const justDraggedRef = useRef(false);

  useEffect(() => {
    const viewport = viewportSize();
    const saved = parseStoredPosition(localStorage.getItem(storageKey)) ?? defaultPosition(viewport);
    const restored = clampToViewport(saved, size, viewport);
    setPosition((current) => current ?? restored);
  }, [storageKey, size, defaultPosition]);

  useEffect(() => {
    if (!position || isDragging) return;
    localStorage.setItem(storageKey, JSON.stringify(position));
  }, [position, isDragging, storageKey]);

  const startDrag = useCallback((pointer: Point) => {
    if (!position) return;
    gestureRef.current = { pointerStart: pointer, positionStart: position, hasMoved: false };
    setIsDragging(true);
  }, [position]);

  const moveDrag = useCallback((pointer: Point) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const offset = { x: pointer.x - gesture.pointerStart.x, y: pointer.y - gesture.pointerStart.y };
    if (!gesture.hasMoved && !passesDragThreshold(offset)) return;
    gestureRef.current = { ...gesture, hasMoved: true };
    const target = { x: gesture.positionStart.x + offset.x, y: gesture.positionStart.y + offset.y };
    setPosition(clampToViewport(target, size, viewportSize()));
  }, [size]);

  const endDrag = useCallback(() => {
    const wasDrag = gestureRef.current?.hasMoved ?? false;
    gestureRef.current = null;
    setIsDragging(false);
    if (!wasDrag) return;
    justDraggedRef.current = true;
    setTimeout(() => {
      justDraggedRef.current = false;
    }, CLICK_AFTER_DRAG_MS);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => moveDrag({ x: e.clientX, y: e.clientY });
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', endDrag);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', endDrag);
    };
  }, [isDragging, moveDrag, endDrag]);

  const dragHandlers = {
    onMouseDown: (e: React.MouseEvent) => {
      e.preventDefault();
      startDrag({ x: e.clientX, y: e.clientY });
    },
    onTouchStart: (e: React.TouchEvent) => startDrag(touchPoint(e)),
    onTouchMove: (e: React.TouchEvent) => moveDrag(touchPoint(e)),
    onTouchEnd: endDrag,
  };

  /** Whether a click on the handle is the end of a drag, which should not toggle anything. */
  const isClickFromDrag = useCallback(
    () => Boolean(gestureRef.current?.hasMoved) || justDraggedRef.current,
    []
  );

  return { position, isDragging, dragHandlers, isClickFromDrag };
}
