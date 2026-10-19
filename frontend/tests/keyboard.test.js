import { describe, expect, test, vi } from 'vitest';
import { KeyboardManager } from '../js/keyboard-manager.js';

describe('KeyboardManager', () => {
    test('matches combos and respects whenEditing', () => {
        const keyboard = new KeyboardManager();
        const save = vi.fn();
        const undo = vi.fn();
        keyboard.bind('mod+s', save);
        keyboard.bind('mod+z', undo, { whenEditing: false });
        const input = document.createElement('input');
        document.body.append(input);
        keyboard.attach(document);
        const press = (target, init) =>
            target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
        press(input, { key: 's', ctrlKey: true });
        press(input, { key: 'z', ctrlKey: true });
        press(document.body, { key: 'z', ctrlKey: true });
        press(document.body, { key: 'z' });
        expect(save).toHaveBeenCalledTimes(1);
        expect(undo).toHaveBeenCalledTimes(1);
        keyboard.detach(document);
    });
});
