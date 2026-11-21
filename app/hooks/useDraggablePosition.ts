'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { dragStep, restoredPosition, type DragGesture, type Point, type Size } from '@/lib/utils/draggablePosition';

interface DraggablePositionOptions {
  storageKey: string;
  /** The box kept inside the viewport. Pass a module constant so it keeps its identity between renders. */
  size: Size;
  /** Where the element sits until it is first moved. Pass a module-level function for the same reason. */
  defaultPosition: (viewport: Size) => Point;
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
    const restored = restoredPosition({
      stored: localStorage.getItem(storageKey),
      size,
      viewport,
      defaultPosition: defaultPosition(viewport),
    });
    setPosition((current) => current ?? restored);
  }, [storageKey, size, defaultPosition]);

  useEffect(() => {
    if (!position || isDragging) return;
    // A full storage only costs the saved position; letting the error escape would unmount the reader.
    try {
      localStorage.setItem(storageKey, JSON.stringify(position));
    } catch {}
  }, [position, isDragging, storageKey]);

  const startDrag = useCallback((pointer: Point) => {
    if (!position) return;
    gestureRef.current = { pointerStart: pointer, positionStart: position, hasMoved: false };
    setIsDragging(true);
  }, [position]);

  const moveDrag = useCallback((pointer: Point) => {
    const gesture = gestureRef.current;
    if (!gesture) return;
    const step = dragStep({ gesture, pointer, size, viewport: viewportSize() });
    if (!step) return;
    gestureRef.current = step.gesture;
    setPosition(step.position);
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
