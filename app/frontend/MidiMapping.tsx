import { SettingsCard } from './SettingsSearch';
import { Children, isValidElement, createContext, useContext, useEffect, useRef, useState, type ReactNode, type ButtonHTMLAttributes, type SelectHTMLAttributes } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { DeviceRefresh } from './DeviceRefresh';
import { Slider, type SliderProps } from './Slider';
import './midi-mapping.css';

export type MidiTarget = { id: string; label: string; kind: 'number' | 'action' | 'switch' | 'choice' | 'relative'; min?: number; max?: number; defaultMin?: number; defaultMax?: number; step?: number; choices?: string[]; disabled?: boolean; priority?: number; defaultMode?: MidiBinding['mode']; read?: () => number; apply: (value: number) => void };
type MidiSource = { type?: 'cc'; cc: number } | { type: 'note'; note: number };
export type MidiBinding = MidiSource & { target: string; label: string; device: number; channel: number; min: number; max: number; mode: 'absolute' | 'trigger' | 'gate' | 'relative-twos' | 'relative-offset' | 'relative-sign' | 'wheel-absolute'; invert: boolean };
export type MidiCc = { type?: 'cc'; device: number; channel: number; cc: number; value: number };
export type MidiMessage = MidiSource & { device: number; channel: number; value: number };
const sourceNumber = (source: MidiSource) => source.type === 'note' ? source.note : source.cc;
const sourceType = (source: MidiSource) => source.type ?? 'cc';
const bindingKey = (binding: MidiBinding) => `${binding.target}:${binding.device}:${binding.channel}:${sourceType(binding)}:${sourceNumber(binding)}`;
export function mappedValue(binding: MidiBinding, target: MidiTarget, raw: number) {
  const ratio = (binding.invert ? 127 - raw : raw) / 127;
  const min = Math.min(binding.min, binding.max), max = Math.max(binding.min, binding.max);
  let value = binding.min + ratio * (binding.max - binding.min);
  if (target.kind === 'choice') return Math.min((target.choices?.length ?? 1) - 1, Math.max(0, Math.round(value)));
  if (target.step) value = (target.min ?? 0) + Math.round((value - (target.min ?? 0)) / target.step) * target.step;
  return Math.min(target.max ?? max, Math.max(target.min ?? min, value));
}
export function wheelDelta(mode: MidiBinding['mode'], raw: number, previous?: number) {
  if (mode === 'relative-twos') return raw === 64 ? 0 : raw < 64 ? raw : raw - 128;
  if (mode === 'relative-offset') return raw - 64;
  if (mode === 'relative-sign') return raw <= 64 ? raw % 64 : -(raw - 64);
  if (mode === 'wheel-absolute' && previous !== undefined) return ((raw - previous + 192) % 128) - 64;
  return 0;
}
function saved<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; } }
function savedBindings(): MidiBinding[] {
  const value = saved<unknown>('vira.midi-bindings.v1', []);
  return Array.isArray(value) ? value.filter((b): b is MidiBinding => b && typeof b.target === 'string' && typeof b.label === 'string' && Number.isInteger(b.device) && Number.isInteger(b.channel) && b.channel >= 1 && b.channel <= 16 && (b.type === undefined || b.type === 'cc' || b.type === 'note') && Number.isInteger(b.type === 'note' ? b.note : b.cc) && (b.type === 'note' ? b.note : b.cc) >= 0 && (b.type === 'note' ? b.note : b.cc) <= 127 && Number.isFinite(b.min) && Number.isFinite(b.max) && ['absolute','trigger','gate','relative-twos','relative-offset','relative-sign','wheel-absolute'].includes(b.mode) && typeof b.invert === 'boolean') : [];
}
function savedEnabled(): number[] { const value = saved<unknown>('vira.midi-enabled.v1', []); return Array.isArray(value) ? value.filter(Number.isInteger) : []; }
const registry = new Map<string, Map<symbol, MidiTarget>>();
export function useMidiTargets(targets: MidiTarget[]) {
  const owner = useRef(Symbol());
  // Register the latest handlers on every render, and remove only this owner's targets.
  useEffect(() => {
    const token = owner.current;
    for (const t of targets) { if (!registry.has(t.id)) registry.set(t.id, new Map()); registry.get(t.id)!.set(token, t); }
    return () => { for (const t of targets) { const entries = registry.get(t.id); entries?.delete(token); if (!entries?.size) registry.delete(t.id); } };
  });
}
function targetFor(id: string) { return [...(registry.get(id)?.values() ?? [])].sort((a,b) => (b.priority ?? 0) - (a.priority ?? 0))[0]; }
type ControllerBehavior = 'jump' | 'grab';
type Pickup = { binding: MidiBinding; previous?: number; grabbed: boolean; observed: number; sent: number[] };
const Context = createContext<{ behavior: ControllerBehavior; changeBehavior: (value: ControllerBehavior) => void; mode: boolean; bindings: MidiBinding[]; selected: string; selectedBinding: string; selectBinding: (key: string) => void; select: (id: string) => void; toggle: () => void; devices: {id:number;name:string}[]; enabled: number[]; enable: (id:number, on:boolean) => void; error: string; refresh: () => Promise<void>; remove: (id:string) => void; edit: (id:string, patch:Partial<Pick<MidiBinding,'min' | 'max' | 'mode' | 'invert'>>) => void; learn: (add?: boolean) => void; learning: boolean } | null>(null);
export function MidiProvider({ children }: {children:ReactNode}) {
  const [mode, setMode] = useState(false), [selected, setSelected] = useState(''), [learning, setLearning] = useState(false);
  const [selectedBinding, setSelectedBinding] = useState('');
  const replacing = useRef<string | null>(null);
  const [bindings, setBindings] = useState<MidiBinding[]>(savedBindings);
  const [behavior, setBehavior] = useState<ControllerBehavior>(() => saved<unknown>('vira.midi-behavior.v1', 'grab') === 'jump' ? 'jump' : 'grab');
  const pickups = useRef(new Map<string, Pickup>());
  const [enabled, setEnabled] = useState<number[]>(savedEnabled);
  const [devices, setDevices] = useState<{id:number;name:string}[]>([]), [error, setError] = useState('');
  const latest = useRef({mode, selected, learning, bindings, enabled, behavior}); latest.current = {mode, selected, learning, bindings, enabled, behavior};
  const previous = useRef(new Map<string, number>());
  const gates = useRef(new Map<string, {target: string; device: number}>());
  function releaseGates(device?: number) {
    const released = new Set<string>();
    for (const [key, source] of gates.current) {
      if (device !== undefined && source.device !== device) continue;
      released.add(source.target); gates.current.delete(key);
    }
    for (const id of released) if (![...gates.current.values()].some(source => source.target === id)) targetFor(id)?.apply(0);
  }
  useEffect(() => { localStorage.setItem('vira.midi-bindings.v1', JSON.stringify(bindings)); }, [bindings]);
  useEffect(() => { localStorage.setItem('vira.midi-behavior.v1', JSON.stringify(behavior)); }, [behavior]);
  useEffect(() => { localStorage.setItem('vira.midi-enabled.v1', JSON.stringify(enabled)); }, [enabled]);
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await invoke<{devices:{id:number;name:string}[];messages:MidiMessage[]}>('midi_mapping_poll', {enabled:latest.current.enabled});
        if (stopped) return;
        if (result && Array.isArray(result.devices) && Array.isArray(result.messages)) {
          for (const [id, pickup] of pickups.current) {
            const target = targetFor(pickup.binding.target);
            if (!result.devices.some(d => d.id === pickup.binding.device) || !target || target.disabled) pickups.current.delete(id);
          }
          for (const device of new Set([...gates.current.values()].map(source => source.device))) { if (!result.devices.some(d => d.id === device)) releaseGates(device); }
          setDevices(old => JSON.stringify(old) === JSON.stringify(result.devices) ? old : result.devices); setError('');
          const wheelMoves = new Map<string, number>();
          for (const message of result.messages) {
            const state = latest.current;
            if (!state.enabled.includes(message.device)) continue;
            if (state.mode) {
              if (state.learning && state.selected && !(message.type === 'note' && message.value === 0)) {
                const target = targetFor(state.selected); if (!target || (target.kind === 'relative' && message.type === 'note')) continue;
                const binding: MidiBinding = {target:target.id, label:target.label, device:message.device, channel:message.channel, ...(message.type === 'note' ? {type:'note' as const,note:message.note} : {type:'cc' as const,cc:message.cc}), min:target.defaultMin ?? target.min ?? 0, max:target.defaultMax ?? target.max ?? (target.kind === 'choice' ? (target.choices?.length ?? 1) - 1 : 1), mode:target.defaultMode ?? (target.kind === 'action' || target.kind === 'switch' ? 'trigger' : 'absolute'), invert:false};
                // Keep other controls for this target; learning an existing source never duplicates it.
                const key = bindingKey(binding), replace = replacing.current;
                setBindings(old => {
                  const existing = old.find(b => bindingKey(b) === key && bindingKey(b) !== replace);
                  return [...old.filter(b => bindingKey(b) !== replace && bindingKey(b) !== key), existing ?? binding];
                });
                setSelectedBinding(key); setLearning(false); latest.current = {...state, learning:false};
              }
              continue;
            }
            const key = `${message.device}:${message.channel}:${sourceType(message)}:${sourceNumber(message)}`;
            const previousRaw = previous.current.get(key);
            const prev = previousRaw ?? 0; previous.current.set(key, message.value);
            for (const binding of state.bindings.filter(b => b.device === message.device && b.channel === message.channel && sourceType(b) === sourceType(message) && sourceNumber(b) === sourceNumber(message))) {
              const target = targetFor(binding.target); if (!target || target.disabled) { pickups.current.delete(bindingKey(binding)); continue; }
              const raw = message.type === 'note' ? (message.value > 0 ? 127 : 0) : message.value;
              const oldRaw = message.type === 'note' ? (prev > 0 ? 127 : 0) : prev;
              const value = binding.invert ? 127 - raw : raw, oldValue = binding.invert ? 127 - oldRaw : oldRaw;
              if (target.kind === 'relative') {
                if (message.type === 'note') continue;
                const delta = wheelDelta(binding.mode, raw, previousRaw) * (binding.invert ? -1 : 1);
                if (delta) wheelMoves.set(target.id, (wheelMoves.get(target.id) ?? 0) + delta);
              }
              else if (binding.mode === 'trigger' && target.defaultMode !== 'gate') { if (value >= 64 && (message.type === 'note' || oldValue < 64)) target.apply(target.kind === 'switch' ? (target.read?.() ? 0 : 1) : 1); }
              else if (binding.mode === 'gate' || binding.mode === 'trigger' && target.defaultMode === 'gate') {
                if ((value >= 64) !== (oldValue >= 64)) {
                  const wasHeld = [...gates.current.values()].some(source => source.target === target.id);
                  if (value >= 64) gates.current.set(bindingKey(binding), {target:target.id,device:message.device});
                  else gates.current.delete(bindingKey(binding));
                  const held = [...gates.current.values()].some(source => source.target === target.id);
                  if (held !== wasHeld) target.apply(held ? 1 : 0);
                }
              }
              else if (message.type !== 'note' || message.value > 0) {
                const next = mappedValue(binding, target, message.value);
                if (state.behavior === 'grab' && message.type !== 'note' && (target.kind === 'number' || target.kind === 'choice')) {
                  const current = target.read?.();
                  if (current === undefined || !Number.isFinite(current)) continue;
                  // Allow half a MIDI step so values between two CC positions remain reachable.
                  const tolerance = Math.max(Math.abs(binding.max - binding.min) / 254 + (target.step ?? 0) / 2, 1e-7);
                  let pickup = pickups.current.get(bindingKey(binding));
                  if (!pickup || pickup.binding !== binding) {
                    pickup = {binding, grabbed:false, observed:current, sent:[]}; pickups.current.set(bindingKey(binding), pickup);
                  }
                  if (Math.abs(current - pickup.observed) > 1e-7) {
                    // Engine/UI feedback can lag several messages; recognize our own pending writes.
                    let acknowledged = -1;
                    for (let i = pickup.sent.length - 1; i >= 0; i--) { if (Math.abs(pickup.sent[i] - current) <= tolerance) { acknowledged = i; break; } }
                    if (acknowledged >= 0) pickup.sent.splice(0, acknowledged + 1);
                    else { pickup.grabbed = false; pickup.previous = undefined; pickup.sent = []; }
                    pickup.observed = current;
                  }
                  const crossed = pickup.previous !== undefined && (pickup.previous - current) * (next - current) <= 0;
                  if (!pickup.grabbed && (Math.abs(next - current) <= tolerance || crossed)) pickup.grabbed = true;
                  pickup.previous = next;
                  if (!pickup.grabbed) continue;
                  pickup.sent.push(next); if (pickup.sent.length > 256) pickup.sent.shift();
                }
                target.apply(next);
              }
            }
          }
          for (const [id, delta] of wheelMoves) { const target = targetFor(id); if (target && !target.disabled) target.apply(delta); }
        }
      } catch (e) { if (!stopped) setError(String(e)); }
      if (!stopped) timer = setTimeout(() => void poll(), 35);
    }
    void poll(); return () => { stopped = true; clearTimeout(timer); releaseGates(); };
  }, []);
  const select = (id: string) => {
    const binding = latest.current.bindings.find(b => b.target === id);
    setSelected(id); setSelectedBinding(binding ? bindingKey(binding) : '');
    replacing.current = null; setLearning(!binding && !!id);
  };
  const selectBinding = (key: string) => {
    const binding = latest.current.bindings.find(b => bindingKey(b) === key);
    setSelected(binding?.target ?? ''); setSelectedBinding(key); setLearning(false);
  };
  function capture(event: React.SyntheticEvent) {
    if (!mode || !(event.target instanceof Element)) return;
    const el = event.target.closest<HTMLElement>('[data-midi-target]'); if (!el) return;
    event.preventDefault(); event.stopPropagation();
    if (event.type === 'pointerdown' || event.type === 'click') select(el.dataset.midiTarget!);
  }
  return <Context.Provider value={{behavior, changeBehavior:value => { pickups.current.clear(); setBehavior(value); }, mode, selected, selectedBinding, selectBinding, learning, bindings, devices, enabled, error, refresh:async () => { try { const result = await invoke<{inputs:{id:number;name:string}[]}>('get_midi_devices'); setDevices(result.inputs); setError(''); } catch (e) { setError(String(e)); } }, select, toggle:() => { releaseGates(); setMode(v => !v); setSelected(''); setLearning(false); previous.current.clear(); pickups.current.clear(); }, enable:(id,on) => { if (!on) releaseGates(id); previous.current.clear(); pickups.current.clear(); setEnabled(old => on ? [...new Set([...old,id])] : old.filter(v => v !== id)); }, remove:key => {
    pickups.current.delete(key);
    const remaining = bindings.filter(b => bindingKey(b) !== key);
    setBindings(remaining);
    const next = remaining.find(b => b.target === selected);
    setSelectedBinding(next ? bindingKey(next) : ''); replacing.current = null; setLearning(!next);
  }, edit:(key,patch) => { pickups.current.delete(key); setBindings(old => old.map(b => bindingKey(b) === key ? {...b,...patch} : b)); }, learn:(add = false) => { replacing.current = add ? null : selectedBinding; setLearning(true); }}}><div className={mode ? 'midi-root midi-map-mode' : 'midi-root'} onPointerDownCapture={capture} onClickCapture={capture} onDoubleClickCapture={capture} onKeyDownCapture={event => { if (mode && event.target instanceof Element && event.target.closest('[data-midi-target]')) capture(event); }}>{children}</div></Context.Provider>;
}
export function useMidiWorkspace(prefix: string) { return useContext(Context)?.bindings.some(b => b.target.startsWith(prefix)) ?? false; }
export function useMidiMarkers() {
  const context = useContext(Context);
  return (id: string) => ({'data-midi-target':id,'data-midi-mapped':context?.bindings.some(b => b.target === id) || undefined,'data-midi-selected':context?.selected === id || undefined});
}
export function useMidiControl(target: MidiTarget | null) {
  useMidiTargets(target ? [target] : []);
  const markers = useMidiMarkers();
  return target ? markers(target.id) : {};
}
export function MidiToggle() { const c = useContext(Context)!; return <button className="midi-map-toggle" aria-pressed={c.mode} onClick={c.toggle}>MIDI map</button>; }
export function MidiSettings() {
  const c = useContext(Context)!;
  return <SettingsCard className="settings-card"><h3 className="device-list-heading">MIDI controllers<DeviceRefresh label="Refresh MIDI controllers" refresh={c.refresh} /></h3><div className="settings-row"><div><strong>Controller behaviour</strong><p>Grab waits until a knob or slider reaches the current control value. Jump changes the value immediately.</p></div><select aria-label="MIDI controller behaviour" value={c.behavior} onChange={e => c.changeBehavior(e.target.value as ControllerBehavior)}><option value="grab">Grab</option><option value="jump">Jump</option></select></div><p className="settings-hint">Enable inputs for MIDI learning and interface control. Routing MIDI permissions are independent.</p>{[...c.devices, ...c.enabled.filter(id => !c.devices.some(d => d.id === id)).map(id => ({id,name:`Controller ${id} · disconnected`}))].map(d => <label className="settings-row" key={d.id}><span>{d.name}</span><input type="checkbox" aria-label={`Enable MIDI mapping from ${d.name}`} checked={c.enabled.includes(d.id)} onChange={e => c.enable(d.id,e.target.checked)} /></label>)}{!c.devices.length && <p className="settings-hint">No MIDI inputs connected. Devices refresh automatically.</p>}{c.error && <p role="alert" className="settings-error">{c.error}</p>}</SettingsCard>;
}
export function MidiEditor() {
  const c = useContext(Context)!;
  if (!c.mode) return null;
  const binding = c.bindings.find(b => bindingKey(b) === c.selectedBinding), target = targetFor(c.selected);
  return <aside className="midi-editor" aria-label="MIDI mapping editor">{c.bindings.length > 0 && <select aria-label="Saved MIDI mappings" value={binding ? c.selectedBinding : ''} onChange={e => c.selectBinding(e.target.value)}><option value="">Saved mappings…</option>{c.bindings.map(b => <option key={bindingKey(b)} value={bindingKey(b)}>{b.label} · {c.devices.find(d => d.id === b.device)?.name ?? `Controller ${b.device}`} · Ch {b.channel} · {b.type === 'note' ? 'Note' : 'CC'} {sourceNumber(b)}</option>)}</select>}<strong>{target?.label ?? binding?.label ?? 'MIDI mapping'}</strong>{!c.selected ? <span>Select a yellow control to map it. Green controls already have a mapping.</span> : <><span role="status">{c.learning ? c.enabled.length ? 'Listening for a CC or Note On…' : 'Enable a MIDI controller in Settings to learn a CC or note.' : 'Mapped'}</span>{binding && <><span>{c.devices.find(d => d.id === binding.device)?.name ?? `Controller ${binding.device}`} · Ch {binding.channel} · {binding.type === 'note' ? 'Note' : 'CC'} {sourceNumber(binding)}</span><label>Behavior <select aria-label="MIDI mapping behavior" value={binding.mode === 'trigger' && target?.defaultMode === 'gate' ? 'gate' : binding.mode} onChange={e => c.edit(bindingKey(binding),{mode:e.target.value as MidiBinding['mode']})}>{(!target || target.kind === 'number' || target.kind === 'choice' || target.kind === 'switch') && <option value="absolute">Absolute</option>}{target?.kind !== 'relative' && target?.defaultMode !== 'gate' && <option value="trigger">Press / toggle</option>}{(!target || target.kind === 'switch') && <option value="gate">Gate</option>}{(!target || target.kind === 'relative') && <><option value="relative-twos">Wheel · two’s complement (1 / 127)</option><option value="relative-offset">Wheel · offset (65 / 63)</option><option value="relative-sign">Wheel · sign magnitude (1 / 65)</option><option value="wheel-absolute">Wheel · absolute with wrap</option></>}</select></label>{binding.mode === 'absolute' && <>{(['min','max'] as const).map(key => <label key={key}>{key === 'min' ? 'From' : 'To'} <input aria-label={`MIDI mapping ${key}`} type="number" step="any" value={binding[key]} onChange={e => {if(e.target.value && Number.isFinite(+e.target.value)) c.edit(bindingKey(binding),{[key]:+e.target.value});}} /></label>)}</>}<label><input type="checkbox" checked={binding.invert} onChange={e => c.edit(bindingKey(binding),{invert:e.target.checked})} /> Invert</label><button onClick={() => c.learn(true)}>Add another control</button><button onClick={() => c.learn()}>Relearn</button><button onClick={() => c.remove(bindingKey(binding))}>Remove</button></>}</>}<span className="midi-editor-count">{c.bindings.length} mappings</span></aside>;
}
// Standard React control adapters. Explicit IDs override accessible names; labels never determine entity identity.
type Identity = { midiId?: string };
export function MidiButton({midiId,...props}: ButtonHTMLAttributes<HTMLButtonElement> & Identity) {
  const ref = useRef<HTMLButtonElement>(null);
  const label = props['aria-label'] ?? (typeof props.children === 'string' ? props.children : undefined);
  const id = midiId ?? props['aria-label'];
  const attrs = useMidiControl(id && props.onClick ? {id:`ui:${id}`,label:label ?? id,kind:'action',disabled:props.disabled,apply:() => ref.current?.click()} : null);
  return <button ref={ref} {...props} {...attrs} />;
}
export function MidiInput({midiId,handleSize,orientation,...props}: SliderProps & Identity) {
  const label = props['aria-label'], id = midiId ?? label;
  const checked = useRef(props.checked); checked.current = props.checked;
  const numeric = props.type === 'range' || props.type === 'number', check = props.type === 'checkbox';
  const attrs = useMidiControl(id && (numeric || check) && props.onChange ? {id:`ui:${id}`,label:label ?? id,kind:check ? 'switch':'number',min:Number(props.min ?? 0),max:Number(props.max ?? 1),step:props.step === 'any' ? undefined : Number(props.step ?? 1),disabled:props.disabled,read:() => check ? (checked.current ? 1 : 0) : Number(props.value),apply:value => {
    if (check) checked.current = value >= .5;
    const input = {value:String(value),checked:check ? value >= .5 : false} as HTMLInputElement;
    props.onChange?.({target:input,currentTarget:input} as React.ChangeEvent<HTMLInputElement>);
  }} : null);
  return props.type === 'range'
    ? <Slider {...props} {...attrs} handleSize={handleSize} orientation={orientation} />
    : <input {...props} {...attrs} />;
}
export function MidiSelect({midiId,...props}: SelectHTMLAttributes<HTMLSelectElement> & Identity) {
  const ref = useRef<HTMLSelectElement>(null), label = props['aria-label'], id = midiId ?? label;
  function values(children: ReactNode): string[] {
    return Children.toArray(children).flatMap(child => {
      if (!isValidElement<{value?:string|number;disabled?:boolean;children?:ReactNode}>(child)) return [];
      if (child.type === 'option') return child.props.disabled ? [] : [String(child.props.value ?? child.props.children ?? '')];
      return values(child.props.children);
    });
  }
  const choices = values(props.children);
  const attrs = useMidiControl(id && props.onChange ? {id:`ui:${id}`,label:label ?? id,kind:'choice',choices,min:0,max:Math.max(0,choices.length-1),step:1,disabled:props.disabled,read:() => choices.indexOf(String(props.value ?? ref.current?.value)),apply:value => {
    const el = {value:choices[Math.round(value)]} as HTMLSelectElement;
    if (el.value !== undefined) props.onChange?.({target:el,currentTarget:el} as React.ChangeEvent<HTMLSelectElement>);
  }} : null);
  return <select ref={ref} {...props} {...attrs} />;
}
