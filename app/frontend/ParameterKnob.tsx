import { useRef } from 'react';
import { useMidiControl } from './MidiMapping';

export function formatParameterValue(value: number) {
  const magnitude = Math.abs(value);
  if (magnitude > 0 && magnitude < .01) return value.toExponential(0);
  const scale = magnitude >= 999500 ? 1e6 : magnitude >= 999.5 ? 1e3 : 1;
  const scaled = value / scale;
  const decimals = Math.abs(scaled) >= 100 ? 0 : Math.abs(scaled) >= 10 ? 1 : 2;
  return `${Number(scaled.toFixed(scale === 1 ? decimals : Math.min(1, decimals)))}${scale === 1e6 ? 'M' : scale === 1e3 ? 'k' : ''}`;
}

type Props = {
  label: string; ariaLabel?: string; value: number; min: number; max?: number;
  step?: number; defaultValue: number; disabled?: boolean; defaultRange?: number;
  midiId?: string; formatValue?: (value: number) => string;
  onChange: (value: number) => void; onInteractionStart?: () => void; onInteractionEnd?: () => void;
};

export function ParameterKnob({ label, ariaLabel = label, value, min, max, step, defaultValue, disabled = false, defaultRange = 1, midiId, formatValue = String, onChange, onInteractionStart, onInteractionEnd }: Props) {
  const drag = useRef<{ pointer: number; y: number; value: number; range: number } | null>(null);
  const latest = useRef(value); latest.current = value;
  const range = max === undefined ? defaultRange + Math.max(0, value - min) : max - min;
  const fraction = (next: number) => max === undefined
    ? Math.max(0, next - min) / (Math.max(0, next - min) + defaultRange)
    : max === min ? 0 : Math.max(0, Math.min(1, (next - min) / (max - min)));
  const position = fraction(value), neutral = fraction(defaultValue);
  const angle = (position - neutral) * 300;
  const point = (part: number) => { const radians = ((part - .5) * 300 - 90) * Math.PI / 180; return `${20 + 17 * Math.cos(radians)} ${20 + 17 * Math.sin(radians)}`; };
  const turn = (next: number) => {
    if (disabled || !Number.isFinite(next)) return;
    const rounded = step ? min + Math.round((next - min) / step) * step : next;
    const clamped = Math.max(min, max === undefined ? rounded : Math.min(max, rounded));
    const result = Number(clamped.toPrecision(12));
    latest.current = result; onChange(result);
  };
  const midi = useMidiControl(midiId ? {id:midiId,label:ariaLabel,kind:'number',min,max,defaultMax:max ?? min + defaultRange,step,disabled,read:() => latest.current,apply:turn} : null);
  const finish = () => { if (!drag.current) return; drag.current = null; onInteractionEnd?.(); };
  const description = formatValue(value);
  return <div className="patch-parameter" title={`${label}: ${description}`}>
    <div {...midi} className="mixer-dial patch-knob" role="slider" tabIndex={disabled ? -1 : 0} aria-disabled={disabled} aria-label={ariaLabel} aria-valuemin={min} aria-valuemax={max ?? min + range} aria-valuenow={value} aria-valuetext={description} title={`${label}: ${description} · Drag to turn · Double-click to reset`}
      onPointerDown={event => {
        if (disabled || event.button !== 0) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.focus();
        onInteractionStart?.(); drag.current = {pointer:event.pointerId,y:event.clientY,value:latest.current,range};
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={event => { const start = drag.current; if (start?.pointer === event.pointerId) turn(start.value + (start.y - event.clientY) / 140 * start.range); }}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      onDoubleClick={event => { event.stopPropagation(); turn(defaultValue); }}
      onKeyDown={event => {
        if (disabled || !['ArrowUp','ArrowRight','ArrowDown','ArrowLeft','Home','End'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === 'End' && max === undefined) return;
        turn(event.key === 'Home' ? min : event.key === 'End' ? max! : latest.current + (['ArrowUp','ArrowRight'].includes(event.key) ? 1 : -1) * (step ?? range / 100));
      }}>
      <svg viewBox="0 0 40 40" aria-hidden="true"><circle className="mixer-dial-base" cx="20" cy="20" r="17" />{Math.abs(angle) > .1 && <path className="mixer-dial-arc" d={`M${point(neutral)} A17 17 0 ${Math.abs(angle) > 180 ? 1 : 0} ${angle > 0 ? 1 : 0} ${point(position)}`} />}<text x="20" y="23" textAnchor="middle">{formatParameterValue(value)}</text></svg>
    </div><span title={label}>{label}</span>
  </div>;
}
