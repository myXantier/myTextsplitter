
// import { createLogger } from '@crowlog/logger';

// const logger = createLogger({ namespace: 'my-app' });
// logger.info('Hello world');
// logger.error({ error: new Error('...') }, 'Something went wrong');


// ^\s*console\.(log|debug|warn|error|info)\(.*\);\s*$

export class Logger {
    protected static debugEnabled = process.env.NODE_ENV === 'development'; // Standard: Debug deaktiviert
  
    private static getCaller(): string {
      const stack = new Error().stack;
      if (!stack) return "UnknownCaller";
  
      const stackLines = stack.split("\n").map((line) => line.trim());
      console.log("stackLines => ", stackLines);
      
      // Die relevante Zeile finden (3. oder 4. Zeile je nach Browser)
      const callerLine = stackLines.find((line) => !line.includes("/Logger.ts") || line.startsWith("@http://")) || "";
      console.log("callerLine => ", callerLine);
      
      if (!callerLine)
        return "UnknownCaller";
  
      // Versuche Funktionsname, Dateiname & Zeilennummer zu extrahieren
      const match = /(?:at|@) [^\/]*((?:(?:[a-zA-Z]+:)|(?:[\/])|(?:\\\\))(?:.+)):(\d+):(\d+)/.exec(callerLine); //callerLine.match(/at (.+?) \((.+):(\d+):(\d+)\)/) || callerLine.match(/at (.+):(\d+):(\d+)/);
      
      if (match) {
        const functionName = match[1]?.replace(/^Object\./, "") || "Anonymous";
        const file = match[2]?.split("/").pop() || "UnknownFile";
        return `${functionName} (${file}:${match[3]})`;
      }
  
      return "UnknownCaller";
    }
  
    static log(message: string, data?: any) {
      if (this.debugEnabled) {
        console.log(`📋 → ${message}`, data);
      }
    }
  
    static debug(message: string, data?: any) {
      if (this.debugEnabled) {
        console.debug(`🐞 [Debug] → ${message}`, data);
      }
    }
  
    static warn(message: string, data?: any) {
      if (this.debugEnabled) {
        console.warn(`⚠️ [Warn] → ${message}`, data);
      }
    }
  
    static error(message: Error | string, data?: any) {
      console.error(`❌ [Error] ${this.getCaller()} → ${message}`, data);
    }
  
    static isDebugEnabled(): boolean {
      return this.debugEnabled;
    }
  
    static setIsDebugEnabled(isEnabled: boolean) {
      this.debugEnabled = isEnabled;
    }
  }
  
  
  export class WorkerLogger extends Logger {
    static log(message: string, data?: any) {
      if (this.debugEnabled) {
        console.log(`📋 [Worker] ${message}`, data);
      }
    }
  
    static debug(message: string, data?: any) {
      if (this.debugEnabled) {
        console.debug(`🐞 [Worker] ${message}`, data);
      }
    }
  
    static warn(message: string, data?: any) {
      if (this.debugEnabled) {
        console.warn(`⚠️ [Worker] ${message}`, data);
      }
    }
  
    static error(message: Error | string, data?: any) {
      console.error(`❌ [Worker] ${message}`, data);
    }
  
    static isDebugEnabled(): boolean {
      return this.debugEnabled;
    }
  
    static setIsDebugEnabled(isEnabled: boolean) {
      this.debugEnabled = isEnabled;
    }
  
  }