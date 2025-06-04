import { Logger } from './Logger';

declare global {
  interface Window {
    currentOS: string | OsType;
    logger: Logger; // Globale Logger-Klasse registrieren
    myResultConverter: <T extends AllowedResultTypes>(myresult: myResult, defaultValue?: T) => Result<T, Error>;
  }
}

export {};
