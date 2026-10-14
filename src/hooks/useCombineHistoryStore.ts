import { create } from 'zustand';
import { DEFAULT_LINE_FORMAT, type LineFormat } from '../utils/lines';

export interface ColumnSeparator {
  index: number;
  separator: string;
}

export interface CombineState {
  text: string;
  columns: ColumnSeparator[];
}

interface CombineHistoryStore {
  past: CombineState[];
  present: CombineState;
  future: CombineState[];
  /** Line format of the text the current split result came from; combined and copied columns use it. Not part of the undo history. */
  lineFormat: LineFormat;

  setLineFormat: (format: LineFormat) => void;
  setCombineState: (newState: CombineState) => void;
  clearCombineState: () => void;
  undoCombine: () => void;
  redoCombine: () => void;

  // Selectors
  getText: () => string;
  getColumns: () => ColumnSeparator[];
  getCombineState: () => CombineState;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useCombineHistoryStore = create<CombineHistoryStore>((set, get) => ({
  past: [],
  present: { text: '', columns: [] },
  future: [],
  lineFormat: DEFAULT_LINE_FORMAT,

  setLineFormat: (lineFormat) => set({ lineFormat }),

  setCombineState: (newPresent) => {
    const { past, present } = get();
    set({
      past: [...past, present],
      present: newPresent,
      future: [],
    });
  },

  undoCombine: () => {
    const { past, present, future } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    const newPast = past.slice(0, -1);
    set({
      past: newPast,
      present: previous,
      future: [present, ...future],
    });
  },

  redoCombine: () => {
    const { past, present, future } = get();
    if (future.length === 0) return;
    const next = future[0];
    const newFuture = future.slice(1);
    set({
      past: [...past, present],
      present: next,
      future: newFuture,
    });
  },

  clearCombineState: () => {
    set({
      past: [],
      present: { text: '', columns: [] },
      future: [],
    });
  },

  getText: () => get().present.text,
  getColumns: () => get().present.columns,
  getCombineState: () => get().present,
  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,
}));
