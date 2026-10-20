import { useState } from 'react';
import { normalizeSearch, SettingsSearch } from './SettingsSearch';

const shortcutCategories = [
  { title: 'Deck playback & tempo', shortcuts: [
    ['Drag master BPM', 'Adjust master tempo continuously; drag right or up to speed up, left or down to slow down; release to stop. Click without dragging to enter a target BPM', 'Header BPM number or bpm label; MIDI map mode off'],
    ['Drag / scroll current deck BPM', 'Change playback tempo; when the locked deck is the only playing track, change master BPM and keep it locked; scroll up speeds up, down slows down; Shift-scroll adjusts in 0.01 BPM steps', 'Loaded deck with a timing grid; audio running; deck not loading; unlocked or locked and the only playing track'],
    ['Double-click original / current deck BPM', 'Unlock and restore the track’s original playback tempo', 'Loaded deck with a timing grid; audio running; deck not loading'],
    ['Double-click AUTO NOW / AUTO END', 'Arm a transition using Fast transition overlap (default 4 bars); button blinks faster', 'Decks page; eligible outgoing deck playing; both decks loaded with timing grids; no loops or scrubbing'],
    ['Enter / Escape', 'Apply target master BPM (15–600) / cancel editing; clicking elsewhere also cancels', 'Master BPM text field is focused after clicking the header BPM number'],
    ['Alt + ←', 'Make deck A active', 'Decks page; outside text fields'],
    ['Alt + →', 'Make deck B active', 'Decks page; outside text fields'],
    ['Shift + Space', 'Tap active deck playback BPM; without a grid, create and save one with the first tap as beat 1 (track BPM 30–300). Locked decks update master BPM and stay locked. Keep Shift held and press Space on each beat. The header confirms each tap; a pause over 4 seconds starts a new tempo', 'Anywhere on the Decks page, including text fields and dropdowns; loaded deck; at least two taps'],
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
    ['Enter / Space', 'Open collection dropdown or select only the focused category name', 'Music collection button or category name receives keyboard input'],
    ['Space', 'Toggle a category while keeping the dropdown open', 'Category checkbox receives keyboard input'],
    ['Escape', 'Close collection dropdown', 'Music collection dropdown is open'],
    ['Escape', 'Close track actions dropdown', 'Track actions dropdown is open and receives keyboard input'],
    ['Cmd + N', 'Toggle selected library track in the planned Play Next order; Autopilot gives new choices priority', 'Decks page; readable track selected; outside text fields; key and collection dropdowns closed'],
    ['Cmd + ←', 'Load selected library track onto deck A', 'Decks page; readable track; deck stopped or deck fader at 0'],
    ['Cmd + →', 'Load selected library track onto deck B', 'Decks page; readable track; deck stopped or deck fader at 0'],
    ['↑ / ↓', 'Select previous / next library track in the selected categories; suppress row hover until the pointer moves or clicks', 'Decks page; collection selector closed'],
    ['Type text', 'Focus library search and append to query', 'Decks page; outside typing fields; without Cmd, Ctrl or Alt; collection selector closed'],
  ] },
  { title: 'Track timing & analysis', shortcuts: [
    ['Play / Pause during Edit grid', 'Listen with the unsaved draft grid, then pause to continue adjusting; the draft and pinned beat stay in place', 'Loaded track; Edit grid enabled; moving, scaling and pinning are disabled during playback'],
    ['Two-finger scroll / slide over rolling waveform', 'Smoothly nudge playback or audition stopped movement with horizontal or vertical trackpad scrolling. Set separate playing and stopped movement in Settings → Waveform trackpad; works in Edit grid mode without changing the grid; pinch still zooms', 'Loaded deck; audio running; MIDI map mode off; not saving the grid; playing deck unlocked'],
    ['MIDI wheel on rolling waveform', 'Smoothly nudge playback or audition stopped movement; map the waveform in MIDI map mode and choose the wheel encoding. Set playing and stopped movement in Settings', 'Loaded deck; audio running; Edit grid off; playing deck unlocked'],
    ['Drag the rolling waveform', 'Move the entire grid; with a pinned beat, drag away from the pin to scale around it (30–300 BPM)', 'Stopped track; Edit grid enabled; hand cursor over unpinned beat marks; with a pin, resize cursor away from it and unavailable cursor over the fixed pin'],
    ['Command-click a beat mark', 'Pin any beat as the scaling centre (green); click another beat to move the pin, or the same beat to unpin', 'Stopped track; Edit grid enabled; Save grid commits changes, Cancel discards them'],
    ['Cmd + B', 'Set reference beat at the playhead; without BPM, set two references to estimate timing from bar starts', 'Decks page; active loaded deck, or first loaded deck; stopped; grid editing closed'],
    ['Cmd + Shift + ← / →', 'Shift bar and yellow four-bar phrase starts one beat earlier / later; all 16 phrase positions are reachable. In Edit grid, adjusts the draft: Save grid commits, Cancel discards. While playing outside Edit grid, master clock follows and tempo lock is preserved', 'Decks page; active loaded deck, or first loaded deck; timing grid required; Edit grid: stopped, no pending launch, save or preview; otherwise stopped or the only playing deck'],
    ['Cmd + Shift + A', 'Approve track analysis', 'Decks page; active loaded deck, or first loaded deck; timing grid required; no unsaved grid edits on either loaded copy; analysed, needs review, or stale with saved analysis; also available while playing'],
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
    ['Drag between input and output ports', 'Add a musical cable in either direction; several patterns can share a device input', 'Patterns canvas; compatible ports; root note and scale inputs accept one cable each'],
    ['Escape', 'Cancel pattern deletion', 'Pattern deletion confirmation is open'],
    ['Drag / double-click palette item', 'Add a node at the drop position / center of the visible canvas', 'Patterns and Routing palettes'],
    ['Double-click pattern / Expand', 'Open the detailed pattern editor', 'Patterns canvas; pattern node'],
    ['Canvas button', 'Restore the pattern patching canvas', 'Expanded pattern editor'],
    ['Delete / Backspace', 'Remove selected node and its cables, or disconnect selected cable', 'Patterns canvas; outside text fields and selectors; pattern definitions stay in the palette'],
    ['Cmd + Z / Cmd + Shift + Z', 'Undo / redo musical routing edits', 'Patterns canvas; outside text fields and selectors'],
    ['Escape', 'Cancel cable/node drag and clear canvas selection', 'Patterns canvas; outside text fields and selectors'],
  ] },
  { title: 'Audio routing', shortcuts: [
    ['Enter / Escape', 'Finish / cancel node renaming; clicking elsewhere also finishes. Apply routing publishes the name to waveforms', 'Routing page; node name text field is focused; no Apply in progress'],
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
  const [search, setSearch] = useState('');
  const query = normalizeSearch(search);
  const categories = shortcutCategories.map(category => ({ ...category, shortcuts: category.shortcuts.filter(shortcut => normalizeSearch(shortcut.join(' ')).includes(query) || normalizeSearch(category.title).includes(query)) })).filter(category => category.shortcuts.length);
  return <section className="settings-page" aria-label="Shortcuts"><div className="settings-inner">
    <div className="settings-heading"><div><h2>Shortcuts</h2><p>Keyboard controls · Alt is Option (⌥) and Cmd is Command (⌘) on macOS.</p></div><SettingsSearch label="Search shortcuts" value={search} onChange={setSearch} /></div>
    <p className="shortcuts-help">Deck controls require the audio engine to be running and decoded track audio to be available. Play / pause also works while waveforms and analysis are still loading; the loading message stays visible. The active deck is highlighted; interacting with a deck also makes it active.</p>
    {!categories.length && <p role="status" className="shortcuts-help">No shortcuts match your search.</p>}
    <div className="shortcut-categories">
      {categories.map(({ title, shortcuts }) => <details className="shortcut-category" key={`${query ? 'search' : 'browse'}-${title}`} open={query ? true : undefined}>
        <summary><span>{title}</span><span className="shortcut-count">{shortcuts.length} shortcuts</span></summary>
        <table className="shortcuts-table" aria-label={`${title} shortcuts`}><thead><tr><th scope="col">Shortcut</th><th scope="col">Action</th><th scope="col">Available when</th></tr></thead>
          <tbody>{shortcuts.map(([keys, action, context]) => <tr key={`${keys}-${action}`}><td><kbd>{keys}</kbd></td><td>{action}</td><td>{context}</td></tr>)}</tbody>
        </table>
      </details>)}
    </div>
  </div></section>;
}
