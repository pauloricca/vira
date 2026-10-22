export type CanvasPoint = { x: number; y: number };
export function canvasPosition(event: { clientX: number; clientY: number }, rect: { left: number; top: number; width: number }, width: number, zoom: number, origin: CanvasPoint = {x:0,y:0}): CanvasPoint {
  const scale = rect.width > 0 ? rect.width / width : zoom;
  return { x: (event.clientX - rect.left) / scale + origin.x, y: (event.clientY - rect.top) / scale + origin.y };
}
export const cablePath = (a: CanvasPoint, b: CanvasPoint) => `M ${a.x} ${a.y} C ${a.x + Math.max(70, Math.abs(b.x - a.x) / 2)} ${a.y}, ${b.x - Math.max(70, Math.abs(b.x - a.x) / 2)} ${b.y}, ${b.x} ${b.y}`;
