//Helper logging function that timestamps each message and optionally outputs to a file as well
function log(msg: string, fileRoot?: string, consoleFormatter?: (msg: string) => string): void {
    assert.notStrictEqual(msg, undefined, "Trying to print undefined.  This usually indicates a bug upstream from the log function.");

    //Pads single digit number with a leading zero, simple helper function for log2
    function toStr(n: number): string { return n < 10 ? '0' + n : '' + n; }

    var fs = require("fs");

    var d = new Date();
    var taggedMsg = "[" + (toStr(d.getMonth() + 1)) + "/" + (toStr(d.getDate())) + "/" + (d.getFullYear()) + " - " + (toStr(d.getHours())) + ":" + (toStr(d.getMinutes())) + ":" + (toStr(d.getSeconds()))/* + "." + (d.getMilliseconds())*/;
    if (fileRoot !== undefined) {
        taggedMsg += (", " + fileRoot.toUpperCase() + "] " + msg);
    } else {
        taggedMsg += ("] " + msg);
    }
    if (consoleFormatter !== undefined) {
        if (consoleFormatter !== null) {
            console.log(consoleFormatter(taggedMsg));
        }
    } else {
        console.log(taggedMsg);
    }

    if (fileRoot !== undefined) {
        var fd = fs.openSync(fileRoot + ".txt", "a"); //@TODO - Could create separate logs per date, or could just slam everything into one file...not sure what's best, but one file is easiest for the moment
        fs.writeSync(fd, taggedMsg + "\r\n");
        fs.closeSync(fd);
    }
}

//Think of this as util.inherits, except that it doesn't completely overwrite
//the prototype of the base object.  It just adds to it.
function applyMixins(derivedCtor: any, baseCtors: any[]) {
    baseCtors.forEach(baseCtor => {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach(name => {
            derivedCtor.prototype[name] = baseCtor.prototype[name];
        })
    });
}

exports.log = log;
exports.applyMixins = applyMixins;