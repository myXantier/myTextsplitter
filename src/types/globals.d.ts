import { Logger } from './Logger';

declare global {
  interface Window {
    currentOS: string | OsType;
    logger: Logger; // Globale Logger-Klasse registrieren
    /** Runtime-checked result conversion, e.g. `myResultConverter(result, 'Text')` */
    myResultConverter: typeof import('../other/TypeConverter').default;
  }
}

export {};
