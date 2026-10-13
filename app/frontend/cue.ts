import { useEffect, useRef, useState } from 'react';

// Keep a held Cue alive across telemetry updates, but release on cancellation.
export function useCue(deck: number, generation: number, ready: boolean, control: (deck: number, action: string) => Promise<void>) {
  const held = useRef(false);
  const keyboard = useRef(false);
  const [pressed, setPressed] = useState(false);
  const send = useRef(control);
  send.current = control;
  function release() {
    if (!held.current) return;
    held.current = false;
    setPressed(false);
    void send.current(deck, 'cue_release');
  }
  function press() {
    if (!ready || held.current) return;
    held.current = true;
    setPressed(true);
    void send.current(deck, 'cue_press');
  }
  useEffect(() => {
    const hide = () => { if (document.hidden) release(); };
    const keyUp = (event: KeyboardEvent) => { if (keyboard.current && (event.key === ' ' || event.key === 'Enter')) release(); };
    window.addEventListener('blur', release);
    window.addEventListener('keyup', keyUp);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('blur', release);
      window.removeEventListener('keyup', keyUp);
      document.removeEventListener('visibilitychange', hide);
      release();
    };
  }, [deck, generation, ready]);
  return { pressed, handlers: {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !ready) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture?.(event.pointerId);
      keyboard.current = false;
      press();
    },
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
    onBlur: (event: React.FocusEvent<HTMLButtonElement>) => {
      if (keyboard.current && !(event.relatedTarget instanceof Element && event.relatedTarget.classList.contains('play-button'))) release();
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      if (!event.repeat) { keyboard.current = true; press(); }
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      release();
    },
    // Assistive technology can activate a button without pointer/key events.
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.detail === 0 && !held.current && ready) { press(); release(); }
    },
  } };
}
