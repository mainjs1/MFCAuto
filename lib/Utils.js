"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var assert = require("assert");
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
var logLevel = LogLevel.INFO;
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
    var fs = require("fs");
    var d = new Date();
    var taggedMsg = "[" + (toStr(d.getMonth() + 1)) + "/" + (toStr(d.getDate())) + "/" + (d.getFullYear()) + " - " + (toStr(d.getHours())) + ":" + (toStr(d.getMinutes())) + ":" + (toStr(d.getSeconds()));
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
        var fd = fs.openSync(fileRoot + ".txt", "a");
        fs.writeSync(fd, taggedMsg + "\r\n");
        fs.closeSync(fd);
    }
}
exports.log = log;
function applyMixins(derivedCtor, baseCtors) {
    "use strict";
    baseCtors.forEach(function (baseCtor) {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach(function (name) {
            derivedCtor.prototype[name] = baseCtor.prototype[name];
        });
    });
}
exports.applyMixins = applyMixins;
//# sourceMappingURL=Utils.js.map