export declare enum LogLevel {
    SILENT = 0,
    ERROR = 1,
    WARNING = 2,
    INFO = 3,
    VERBOSE = 4,
    DEBUG = 5,
    TRACE = 6,
}
export declare function setLogLevel(level: LogLevel): void;
export declare function logWithLevel(level: LogLevel, msg: string, fileRoot?: string, consoleFormatter?: (msg: string) => string): void;
export declare function log(msg: string, fileRoot?: string, consoleFormatter?: (msg: string) => string): void;
export declare function decodeIfNeeded(str: string): string;
export declare function applyMixins(derivedCtor: any, baseCtors: any[]): void;
export declare function httpGet(url: string): Promise<string>;
