"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const assert = require("assert");
const http = require("http");
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["SILENT"] = 0] = "SILENT";
    LogLevel[LogLevel["ERROR"] = 1] = "ERROR";
    LogLevel[LogLevel["WARNING"] = 2] = "WARNING";
    LogLevel[LogLevel["INFO"] = 3] = "INFO";
    LogLevel[LogLevel["VERBOSE"] = 4] = "VERBOSE";
    LogLevel[LogLevel["DEBUG"] = 5] = "DEBUG";
    LogLevel[LogLevel["TRACE"] = 6] = "TRACE";
})(LogLevel = exports.LogLevel || (exports.LogLevel = {}));
let logLevel = LogLevel.INFO;
function setLogLevel(level) {
    "use strict";
    logLevel = level;
}
exports.setLogLevel = setLogLevel;
function logWithLevel(level, msg, fileRoot, consoleFormatter) {
    "use strict";
    if (logLevel >= level) {
        log(msg, fileRoot, consoleFormatter);
    }
}
exports.logWithLevel = logWithLevel;
function log(msg, fileRoot, consoleFormatter) {
    "use strict";
    assert.notStrictEqual(msg, undefined, "Trying to print undefined.  This usually indicates a bug upstream from the log function.");
    function toStr(n) { return n < 10 ? "0" + n : "" + n; }
    let fs = require("fs");
    let d = new Date();
    let taggedMsg = "[" + (toStr(d.getMonth() + 1)) + "/" + (toStr(d.getDate())) + "/" + (d.getFullYear()) + " - " + (toStr(d.getHours())) + ":" + (toStr(d.getMinutes())) + ":" + (toStr(d.getSeconds()));
    if (fileRoot !== undefined) {
        taggedMsg += (", " + fileRoot.toUpperCase() + "] " + msg);
    }
    else {
        taggedMsg += ("] " + msg);
    }
    if (consoleFormatter !== null) {
        if (consoleFormatter) {
            console.log(consoleFormatter(taggedMsg));
        }
        else {
            console.log(taggedMsg);
        }
    }
    if (fileRoot !== undefined) {
        let fd = fs.openSync(fileRoot + ".txt", "a");
        fs.writeSync(fd, taggedMsg + "\r\n");
        fs.closeSync(fd);
    }
}
exports.log = log;
function decodeIfNeeded(str) {
    if (typeof str === "string" && str.indexOf("%") !== -1) {
        try {
            let decoded = decodeURIComponent(str);
            if (decoded === str) {
                return str;
            }
            else {
                let encoded = encodeURIComponent(decoded);
                if (encoded === str) {
                    return decoded;
                }
                else {
                    logWithLevel(LogLevel.DEBUG, `[UTILS] decodeIfNeeded detected partially encoded string? '${str}'`);
                    return str;
                }
            }
        }
        catch (e) {
            logWithLevel(LogLevel.DEBUG, `[UTILS] decodeIfNeeded exception decoding '${str}'`);
            return str;
        }
    }
    else {
        return str;
    }
}
exports.decodeIfNeeded = decodeIfNeeded;
function applyMixins(derivedCtor, baseCtors) {
    "use strict";
    baseCtors.forEach(baseCtor => {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach(name => {
            derivedCtor.prototype[name] = baseCtor.prototype[name];
        });
    });
}
exports.applyMixins = applyMixins;
function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, function (res) {
            let contents = "";
            res.on("data", function (chunk) {
                contents += chunk;
            });
            res.on("end", function () {
                resolve(contents);
            });
        }).on("error", function (e) {
            reject(e);
        });
    });
}
exports.httpGet = httpGet;
//# sourceMappingURL=Utils.js.map