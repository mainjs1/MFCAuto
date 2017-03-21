import * as assert from "assert";

export enum LogLevel {
    SILENT,     // Nothing
    ERROR,      // Only fatal or state corrupting errors
    WARNING,    // Non-fatal warnings
    INFO,       // Status info
    VERBOSE,    // More verbose status info
    DEBUG,      // Debug information that won't be useful to most people
    TRACE,      // Debug information plus the entire packet log
}

let logLevel = LogLevel.INFO;

export function setLogLevel(level: LogLevel) {
    "use strict";
    logLevel = level;
}

// Like "log" but respects different levels
export function logWithLevel(level: LogLevel, msg: string, fileRoot?: string, consoleFormatter?: (msg: string) => string): void {
    "use strict";
    if (logLevel >= level) {
        log(msg, fileRoot, consoleFormatter);
    }
}

// Helper logging function that timestamps each message and optionally outputs to a file as well
export function log(msg: string, fileRoot?: string, consoleFormatter?: (msg: string) => string): void {
    "use strict";
    assert.notStrictEqual(msg, undefined, "Trying to print undefined.  This usually indicates a bug upstream from the log function.");

    // Pads single digit number with a leading zero, simple helper function for log2
    function toStr(n: number): string { return n < 10 ? "0" + n : "" + n; }

    let fs = require("fs");

    let d = new Date();
    let taggedMsg = "[" + (toStr(d.getMonth() + 1)) + "/" + (toStr(d.getDate())) + "/" + (d.getFullYear()) + " - " + (toStr(d.getHours())) + ":" + (toStr(d.getMinutes())) + ":" + (toStr(d.getSeconds()))/* + "." + (d.getMilliseconds())*/;
    if (fileRoot !== undefined) {
        taggedMsg += (", " + fileRoot.toUpperCase() + "] " + msg);
    } else {
        taggedMsg += ("] " + msg);
    }

    // Explicitly passing null, not undefined, as the consoleFormatter
    // means to skip the console output completely
    // tslint:disable:no-null-keyword
    if (consoleFormatter !== null) {
        if (consoleFormatter) {
            console.log(consoleFormatter(taggedMsg));
        } else {
            console.log(taggedMsg);
        }
    }

    if (fileRoot !== undefined) {
        let fd = fs.openSync(fileRoot + ".txt", "a");
        fs.writeSync(fd, taggedMsg + "\r\n");
        fs.closeSync(fd);
    }
}

// Think of this as util.inherits, except that it doesn't completely overwrite
// the prototype of the base object.  It just adds to it.
export function applyMixins(derivedCtor: any, baseCtors: any[]) {
    "use strict";
    baseCtors.forEach(baseCtor => {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach(name => {
            derivedCtor.prototype[name] = baseCtor.prototype[name];
        });
    });
}
