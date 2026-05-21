import { useEffect } from 'react';

export interface SheetKeyboardOpts {
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  onEditTitle?: () => void;
  onSubmit?: () => void;
  disabled?: boolean;
}

export function useSheetKeyboard(opts: SheetKeyboardOpts) {
  const { disabled, onClose, onPrev, onNext, onEditTitle, onSubmit } = opts;
  useEffect(() => {
    if (disabled) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') {
        if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') onSubmit?.();
        return;
      }
      switch (e.key) {
        case 'Escape':
          onClose?.();
          break;
        case 'j':
        case 'J':
        case 'ArrowDown':
          onNext?.();
          break;
        case 'k':
        case 'K':
        case 'ArrowUp':
          onPrev?.();
          break;
        case 'e':
        case 'E':
          onEditTitle?.();
          break;
        default:
          return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, onClose, onPrev, onNext, onEditTitle, onSubmit]);
}
