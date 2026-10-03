import {
  useState,
  type Dispatch,
  type PointerEvent,
  type SetStateAction,
  type WheelEvent,
} from 'react';

const MIN_SCALE = 1;
const MAX_SCALE = 8;
const DOUBLE_CLICK_SCALE = 2.5;

interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

const RESET: ZoomState = { scale: 1, x: 0, y: 0 };

type Point = { x: number; y: number };

function zoomBy(s: ZoomState, deltaY: number): ZoomState {
  const factor = Math.exp(-deltaY * 0.002);
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s.scale * factor));
  return scale === 1 ? RESET : { ...s, scale };
}

function usePan(state: ZoomState, setState: Dispatch<SetStateAction<ZoomState>>) {
  const [drag, setDrag] = useState<Point | null>(null);
  const onPointerDown = (event: PointerEvent) => {
    if (state.scale === 1) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({ x: event.clientX - state.x, y: event.clientY - state.y });
  };
  const onPointerMove = (event: PointerEvent) =>
    drag && setState((s) => ({ ...s, x: event.clientX - drag.x, y: event.clientY - drag.y }));
  const onPointerUp = () => setDrag(null);
  return { onPointerDown, onPointerMove, onPointerUp };
}

/**
 * Wheel and double-click zoom with drag-to-pan for the viewer.
 *
 * @returns The CSS transform, whether zoomed, and handlers to spread on the stage.
 */
export function useZoom() {
  const [state, setState] = useState<ZoomState>(RESET);
  const pan = usePan(state, setState);
  const onWheel = (event: WheelEvent) => setState((s) => zoomBy(s, event.deltaY));
  const onDoubleClick = () =>
    setState((s) => (s.scale > 1 ? RESET : { ...RESET, scale: DOUBLE_CLICK_SCALE }));
  const transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
  return {
    transform,
    zoomed: state.scale > 1,
    handlers: { onWheel, onDoubleClick, ...pan },
  };
}
