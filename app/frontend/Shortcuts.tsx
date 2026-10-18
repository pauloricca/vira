const shortcutCategories = [
  { title: 'Deck playback & tempo', shortcuts: [
    ['Double-click AUTO NOW / AUTO END', 'Arm a transition using Fast transition overlap (default 4 bars); button blinks faster', 'Decks page; eligible outgoing deck playing; both decks loaded with timing grids; no loops or scrubbing'],
    ['Enter / Escape', 'Apply target master BPM (15–600) / cancel editing; clicking elsewhere also cancels', 'Master BPM text field is focused after clicking the header BPM number'],
    ['Alt + ←', 'Make deck A active', 'Decks page; outside text fields'],
    ['Alt + →', 'Make deck B active', 'Decks page; outside text fields'],
    ['Cmd + L', 'Lock active deck to master tempo', 'Decks page; outside text fields; loaded deck with a timing grid'],
    ['Cmd + Shift + L', 'Unlock active deck from master tempo', 'Decks page; outside text fields; loaded deck with a timing grid'],
    ['Hold Space + ←', 'Play / pause deck A; preserves an active AUTO overlap when A is outgoing', 'Decks page; loaded deck; start holding Space outside text fields'],
    ['Hold Space + →', 'Play / pause deck B; preserves an active AUTO overlap when B is outgoing', 'Decks page; loaded deck; start holding Space outside text fields'],
    ['← / →', 'Seek backward / forward 5 seconds within the playable track', 'Deck overview waveform receives keyboard input'],
    ['Home / End', 'Seek to playable zero (first beat) / track end', 'Deck overview waveform receives keyboard input'],
    ['Space or Enter (hold at Cue)', 'Paused away: set Cue (locked: nearest bar/beat per Locked deck start). Playing: return and pause. At Cue: hold to preview; release to return', 'Cue button receives keyboard input; loaded deck'],
  ] },
  { title: 'Library & collections', shortcuts: [
    ['Cmd / Ctrl + click', 'Toggle a track in the selection', 'Library track row; expanded or compact view'],
    ['Shift + click', 'Select a range of tracks in the displayed order', 'Library track row; Cmd/Ctrl also held adds the range to the selection'],
    ['Shift + ↑ / ↓', 'Extend the track selection from its anchor', 'Decks page; library navigation; outside tag controls and collection dropdown'],
    ['↑ / ↓ · Home / End · Type text', 'Move between collections / first or last / find by folder name', 'Music collection dropdown is open'],
    ['Enter / Space', 'Open collection dropdown or apply the focused collection', 'Music collection button or dropdown option receives keyboard input'],
    ['Escape', 'Close collection dropdown', 'Music collection dropdown is open'],
    ['Cmd + N', 'Toggle selected library track in the planned Play Next order; Autopilot gives new choices priority', 'Decks page; readable track selected; outside text fields; key and collection dropdowns closed'],
    ['Cmd + ←', 'Load selected library track onto deck A', 'Decks page; readable track; deck stopped'],
    ['Cmd + →', 'Load selected library track onto deck B', 'Decks page; readable track; deck stopped'],
    ['↑ / ↓', 'Select previous / next library track in the selected collection', 'Decks page; collection selector closed'],
    ['Type text', 'Focus library search and append to query', 'Decks page; outside typing fields; without Cmd, Ctrl or Alt; collection selector closed'],
  ] },
  { title: 'Track timing & analysis', shortcuts: [
    ['Cmd + B', 'Set reference beat at the playhead', 'Decks page; active loaded deck, or first loaded deck; stopped with a timing grid'],
    ['Cmd + Shift + ← / →', 'Shift bar start one beat earlier / later', 'Decks page; active loaded deck, or first loaded deck; stopped with a timing grid'],
    ['Cmd + Shift + A', 'Approve track analysis', 'Decks page; active loaded deck, or first loaded deck; analysed, needs review, or stale with saved analysis; also available while playing'],
    ['← / →', 'Move timing cursor backward / forward 10 ms', 'Timing editor waveform receives keyboard input'],
    ['Shift + ← / →', 'Move timing cursor backward / forward 1 second', 'Timing editor waveform receives keyboard input'],
    ['Home / End', 'Move timing cursor to track beginning / end', 'Timing editor waveform receives keyboard input'],
  ] },
  { title: 'Tags', shortcuts: [
    ['Enter', 'Create a tag', 'New tag name field is focused; name is nonempty; no tag save in progress'],
    ['Escape', 'Cancel tag deletion', 'Tag deletion confirmation is open; deletion has not started'],
  ] },
  { title: 'Patches & key selection', shortcuts: [
    ['Delete / Backspace', 'Ask to remove the selected patch and its routing connections', 'Decks page; a patch is selected; outside text fields; no dialog or patch menu open; audio engine running; patch editor closed'],
    ['↑ / ↓ / ← / → · Home / End', 'Adjust patch parameter / minimum or maximum', 'Patch knob has keyboard focus; patch runtime running'],
    ['Escape', 'Close Add patch dropdown', 'Patches dropdown is open'],
    ['Escape', 'Cancel patch removal', 'Patch panel removal confirmation is open; removal has not started'],
    ['↑ / ↓ · Home / End', 'Move between keys / first or last key', 'Deck key dropdown is open'],
    ['Enter / Space', 'Open key dropdown or apply the focused key', 'Deck key button or dropdown option receives keyboard input'],
    ['Escape', 'Close key dropdown', 'Deck key dropdown is open'],
  ] },
  { title: 'Patterns canvas', shortcuts: [
    ['Escape', 'Cancel pattern deletion', 'Pattern deletion confirmation is open'],
    ['Drag / double-click palette item', 'Add a node at the drop position / center of the visible canvas', 'Patterns and Routing palettes'],
    ['Double-click pattern / Expand', 'Open the detailed pattern editor', 'Patterns canvas; pattern node'],
    ['Canvas button', 'Restore the pattern patching canvas', 'Expanded pattern editor'],
    ['Delete / Backspace', 'Remove selected node and its cables, or disconnect selected cable', 'Patterns canvas; outside text fields and selectors; pattern definitions stay in the palette'],
    ['Cmd + Z / Cmd + Shift + Z', 'Undo / redo musical routing edits', 'Patterns canvas; outside text fields and selectors'],
    ['Escape', 'Cancel cable/node drag and clear canvas selection', 'Patterns canvas; outside text fields and selectors'],
  ] },
  { title: 'Audio routing', shortcuts: [
    ['Delete / Backspace', 'Remove selected added node and its cables, or disconnect selected cable; default Routing nodes are protected; session patches stay in Decks', 'Routing page; outside text/number fields and selectors; no Apply in progress'],
    ['Cmd + Z', 'Undo the last routing edit', 'Routing page; outside text/number fields and selectors; no Apply in progress'],
    ['Cmd + Shift + Z', 'Redo the last undone routing edit', 'Routing page; outside text/number fields and selectors; no Apply in progress'],
    ['Escape', 'Cancel cable/node drag', 'Routing page; outside text/number fields and selectors'],
  ] },
  { title: 'Teia editor', shortcuts: [
    ['Cmd / Ctrl + S', 'Save the current Teia document through Vira', 'Teia editor window; connected host; Save enabled'],
    ['Cmd / Ctrl + Shift + S', 'Save the Teia document under a new patch filename', 'Teia editor window; connected host; Save As enabled'],
    ['Cmd / Ctrl + Z', 'Undo a Teia graph edit', 'Teia editor window; outside editable fields; graph unlocked'],
    ['Cmd / Ctrl + Shift + Z or Cmd / Ctrl + Y', 'Redo a Teia graph edit', 'Teia editor window; outside editable fields; graph unlocked'],
    ['Cmd / Ctrl + C / V', 'Copy / paste Teia graph selection', 'Teia editor window; outside editable fields; graph unlocked'],
    ['Delete / Backspace', 'Delete Teia selection or selected boundary port', 'Teia editor window; outside editable fields; graph unlocked'],
    ['Cmd / Ctrl + Delete / Backspace', 'Delete Teia nodes and bridge compatible connections', 'Teia editor window; outside editable fields; graph unlocked'],
    ['A / S / M / B', 'Set Teia cable mode to add / set / multiply / bend', 'Teia editor window; selected cable or cable being created; no modifiers; outside editable fields'],
    ['X', 'Toggle selected Teia nodes or cables', 'Teia editor window; no modifiers; outside editable fields; graph unlocked'],
    ['Cmd / Ctrl + 0', 'Reset Teia canvas zoom to 100%', 'Teia editor window; outside editable fields'],
    ['Escape', 'Cancel Teia cable reconnection or close an editor dialog/menu', 'Teia editor window; an applicable drag, menu or dialog is active'],
    ['1–9', 'Choose a Selector input', 'Teia editor window; exactly one Selector selected; no modifiers; outside editable fields'],
    ['Space', 'Toggle the Teia patch clock for playback with decks stopped', 'Teia editor window; without Cmd/Ctrl/Alt; outside editable fields and dialogs (playback controls permitted)'],
    ['1–8', 'Choose a Custom Wave curve', 'Teia editor window; Custom Wave selected; outside editable fields'],
  ] },
];

export function Shortcuts() {
  return <section className="settings-page" aria-label="Shortcuts"><div className="settings-inner">
    <div className="settings-heading"><h2>Shortcuts</h2><p>Keyboard controls · Alt is Option (⌥) and Cmd is Command (⌘) on macOS.</p></div>
    <p className="shortcuts-help">Deck controls require the audio engine to be running and the target deck to finish loading. The active deck is highlighted; interacting with a deck also makes it active.</p>
    <div className="shortcut-categories">
      {shortcutCategories.map(({ title, shortcuts }) => <details className="shortcut-category" key={title}>
        <summary><span>{title}</span><span className="shortcut-count">{shortcuts.length} shortcuts</span></summary>
        <table className="shortcuts-table" aria-label={`${title} shortcuts`}><thead><tr><th scope="col">Shortcut</th><th scope="col">Action</th><th scope="col">Available when</th></tr></thead>
          <tbody>{shortcuts.map(([keys, action, context]) => <tr key={`${keys}-${action}`}><td><kbd>{keys}</kbd></td><td>{action}</td><td>{context}</td></tr>)}</tbody>
        </table>
      </details>)}
    </div>
  </div></section>;
}
