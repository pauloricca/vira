const shortcuts = [
  ['Delete / Backspace', 'Remove selected node (and its cables) or selected cable', 'Routing page; outside text/number fields and selectors; no Apply in progress'],
  ['Cmd + Z', 'Undo the last routing edit', 'Routing page; outside text/number fields and selectors; no Apply in progress'],
  ['Cmd + Shift + Z', 'Redo the last undone routing edit', 'Routing page; outside text/number fields and selectors; no Apply in progress'],
  ['Escape', 'Cancel cable/node drag or close the node menu', 'Routing page; outside text/number fields and selectors'],
  ['Alt + ←', 'Make deck A active', 'Decks page; outside text fields'],
  ['Alt + →', 'Make deck B active', 'Decks page; outside text fields'],
  ['Cmd + L', 'Lock active deck to master tempo', 'Decks page; outside text fields; loaded deck with a timing grid'],
  ['Cmd + Shift + L', 'Unlock active deck from master tempo', 'Decks page; outside text fields; loaded deck with a timing grid'],
  ['Hold Space + ←', 'Play / pause deck A', 'Decks page; loaded deck; start holding Space outside text fields'],
  ['Hold Space + →', 'Play / pause deck B', 'Decks page; loaded deck; start holding Space outside text fields'],
  ['Cmd + ←', 'Load selected library track onto deck A', 'Decks page; readable track; deck stopped'],
  ['Cmd + →', 'Load selected library track onto deck B', 'Decks page; readable track; deck stopped'],
  ['↑ / ↓', 'Select previous / next library track', 'Decks page'],
  ['Type text', 'Focus library search and append to query', 'Decks page; without Cmd, Ctrl or Alt'],
  ['Cmd + B', 'Set reference beat at the playhead', 'Decks page; active loaded deck, or first loaded deck; stopped with a timing grid'],
  ['Cmd + Shift + ← / →', 'Shift bar start one beat earlier / later', 'Decks page; active loaded deck, or first loaded deck; stopped with a timing grid'],
  ['Cmd + Shift + A', 'Approve track analysis', 'Decks page; active loaded deck, or first loaded deck; also available while playing'],
  ['← / →', 'Seek backward / forward 5 seconds', 'Deck overview waveform receives keyboard input'],
  ['Home / End', 'Seek to track beginning / end', 'Deck overview waveform receives keyboard input'],
  ['← / →', 'Move timing cursor backward / forward 10 ms', 'Timing editor waveform receives keyboard input'],
  ['Shift + ← / →', 'Move timing cursor backward / forward 1 second', 'Timing editor waveform receives keyboard input'],
  ['Home / End', 'Move timing cursor to track beginning / end', 'Timing editor waveform receives keyboard input'],
  ['Hold Space or Enter', 'Hold Cue preview; release to return to cue point', 'Cue button receives keyboard input; loaded deck'],
];

export function Shortcuts() {
  return <section className="settings-page" aria-label="Shortcuts"><div className="settings-inner">
    <div className="settings-heading"><h2>Shortcuts</h2><p>Keyboard controls · Alt is Option (⌥) and Cmd is Command (⌘) on macOS.</p></div>
    <p className="shortcuts-help">Deck controls require the audio engine to be running and the target deck to finish loading. The active deck is highlighted; interacting with a deck also makes it active.</p>
    <table className="shortcuts-table" aria-label="App keyboard shortcuts"><thead><tr><th scope="col">Shortcut</th><th scope="col">Action</th><th scope="col">Available when</th></tr></thead>
      <tbody>{shortcuts.map(([keys, action, context]) => <tr key={`${keys}-${action}`}><td><kbd>{keys}</kbd></td><td>{action}</td><td>{context}</td></tr>)}</tbody>
    </table>
  </div></section>;
}
