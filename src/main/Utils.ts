import * as assert from "assert";
import * as http from "http";

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

// Takes a string, detects if it was URI encoded,
// and returns the decoded version
export function decodeIfNeeded(str: string): string {
    if (typeof str === "string" && str.indexOf("%") !== -1) {
        try {
            let decoded = decodeURIComponent(str);
            if (decoded === str) {
                // Apparently it wasn't actually encoded
                // So just return it
                return str;
            } else {
                // If it was fully URI encoded, then re-encoding
                // the decoded should return the original
                let encoded = encodeURIComponent(decoded);
                if (encoded === str) {
                    // Yep, it was fully encoded
                    return decoded;
                } else {
                    // It wasn't fully encoded, maybe it wasn't
                    // encoded at all. Be safe and return the
                    // original
                    logWithLevel(LogLevel.DEBUG, `[UTILS] decodeIfNeeded detected partially encoded string? '${str}'`);
                    return str;
                }
            }
        } catch (e) {
            logWithLevel(LogLevel.DEBUG, `[UTILS] decodeIfNeeded exception decoding '${str}'`);
            return str;
        }
    } else {
        return str;
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

// Simple promisified httpGet helper that helps us use
// async/await and have cleaner code elsewhere
export function httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        http.get(url, function (res: any) {
            let contents = "";
            res.on("data", function (chunk: string) {
                contents += chunk;
            });
            res.on("end", function () {
                resolve(contents);
            });
        }).on("error", function (e: any) {
            reject(e);
        });
    });
}
