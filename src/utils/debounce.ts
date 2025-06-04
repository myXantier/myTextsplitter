export default function debounce<T extends (...args: any[]) => Promise<void>>(func: T, wait: number): T {
    let timeout: ReturnType<typeof setTimeout> | null = null;
  
    return function (this: any, ...args: Parameters<T>) {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
  
      return new Promise((resolve, reject) => {
        timeout = setTimeout(() => {
          func(...args)
            .then(resolve)
            .catch(reject);
        }, wait);
      });
    } as T;
  }
  
  
  export interface Cancelable {
    clear(): void;
  }
  
  // Corresponds to 10 frames at 60 Hz.
  // A few bytes payload overhead when lodash/debounce is ~3 kB and debounce ~300 B.
  export function debounceCancelable<T extends (...args: any[]) => any>(func: T, wait = 166) {
    let timeout: ReturnType<typeof setTimeout>;
    function debounced(...args: Parameters<T>) {
      const later = () => {
        // @ts-ignore
        func.apply(this, args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    }
  
    debounced.clear = () => {
      clearTimeout(timeout);
    };
  
    return debounced as T & Cancelable;
  }
  
  
  
  
  
  
  
  export function debounceTEST<T extends (...args: any[]) => void | Promise<void>>(func: T, wait: number): T {
    let timeout: ReturnType<typeof setTimeout> | null = null;
  
    return function (this: any, ...args: Parameters<T>) {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
  
      if (func && func.constructor.name === "AsyncFunction") {
        return new Promise((resolve, reject) => {
          timeout = setTimeout(() => {
            (func as (...args: any[]) => Promise<void>)(...args)
              .then(resolve)
              .catch(reject);
          }, wait);
        });  
      }
      else {
        return () => {
          timeout = setTimeout(() => {
            (func as (...args: any[]) => void)(...args);
          }, wait);
        }
      }
  
    } as T;
  }
  
  
  
  
  type AsyncFunction = (...args: any[]) => Promise<any>;
  
  export function debounceAsync(fn: AsyncFunction, wait: number) {
    let timeoutId: NodeJS.Timeout | undefined;
  
    return function (...args: any[]) {
      clearTimeout(timeoutId);
  
      return new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
          fn(...args)
            .then(resolve)
            .catch(reject);
        }, wait);
      });
    };
  }
  
  export function debounceSync<T extends (...args: any[]) => void>(func: T, wait: number, immediate = false): T {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let lastArgs: Parameters<T> | null = null;
  
    return function (this: any, ...args: Parameters<T>) {
      lastArgs = args;
  
      const later = () => {
        timeout = null;
        if (!immediate && lastArgs) {
          func.apply(this, lastArgs);
          lastArgs = null;
        }
      };
  
      const callNow = immediate && !timeout;
  
      if (timeout !== null) {
        clearTimeout(timeout);
      }
  
      timeout = setTimeout(later, wait);
  
      if (callNow) {
        func.apply(this, args);
      }
    } as T;
  }
  
  export function debounceMini<T extends (...args: any[]) => void>(func: T, wait: number): T {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    return function (this: any, ...args: Parameters<T>) {
      if (timeout !== null) {
        clearTimeout(timeout);
      }
      timeout = setTimeout(() => func.apply(this, args), wait);
    } as T;
  }
  