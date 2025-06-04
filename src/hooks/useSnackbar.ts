import { useSnackbarContext } from '../other/SnackbarProvider';
import { SnackbarPosition } from '../other/Snackbar';

export default function useSnackbar() {
  const { addMessage } = useSnackbarContext();

  return {
    success: (text: string, duration?: number, position?: SnackbarPosition) => addMessage(text, 'success', duration, position),
    info: (text: string, duration?: number, position?: SnackbarPosition) => addMessage(text, 'info', duration, position),
    warning: (text: string, duration?: number, position?: SnackbarPosition) => addMessage(text, 'warning', duration, position),
    error: (text: string, duration: number = 10000, position: SnackbarPosition = 'top-center') => addMessage(text, 'error', duration, position),
  };
}