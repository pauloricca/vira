import { MidiButton, MidiSelect } from './MidiMapping';
export function selectorLabel(index: number): string {
  let label = ''; do { label = String.fromCharCode(65 + index % 26) + label; index = Math.floor(index / 26) - 1; } while (index >= 0); return label;
}
export function selectorPorts(occupied: string[], selected = 'A'): string[] {
  const ports: string[] = []; let i = 0;
  do { ports.push(selectorLabel(i++)); } while (!ports.includes(selected) || occupied.some(port => !ports.includes(port)) || occupied.includes(ports[ports.length - 1]));
  return ports;
}
export function SelectorControl({id, ports, selected, onChange, buttons = false, disabled = false}: {id:string; ports:string[]; selected:string; onChange:(value:string) => void; buttons?:boolean; disabled?:boolean}) {
  return buttons ? <div className="selector-buttons" role="group" aria-label="Selector input">{ports.map(port => <MidiButton key={port} midiId={`${id}:select:${port}`} aria-pressed={selected === port} disabled={disabled} onClick={() => onChange(port)}>{port}</MidiButton>)}</div>
    : <label>Input<MidiSelect midiId={`${id}:selection`} aria-label={`${id} selected input`} disabled={disabled || !ports.length} value={ports.includes(selected) ? selected : ''} onChange={e => onChange(e.target.value)}>{!ports.includes(selected) && <option value="" disabled hidden>{ports.length ? 'Select input' : 'No connected inputs'}</option>}{ports.map(port => <option key={port}>{port}</option>)}</MidiSelect></label>;
}
