(redo => {
    const target = document.activeElement || document.body;
    const event = new KeyboardEvent('keydown', {
        key: 'z', code: 'KeyZ', metaKey: true, shiftKey: redo,
        bubbles: true, cancelable: true,
    });
    if (target.dispatchEvent(event) && target.closest('input,textarea,[contenteditable=true]')) {
        document.execCommand(redo ? 'redo' : 'undo');
    }
})
