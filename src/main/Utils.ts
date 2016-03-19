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

//Forward declarations for Map and Set, which TypeScript won't recognize
//when your compilation target is set to ES5, which we need to keep as our
//target because even the latest Node versions (as of Feb 14, 2016) don't
//support everything TypeScript tries to emit when you set the target to ES6,
//and I don't really want to add an intermediate compilation step through
//Babel or any such nonsense.
interface Map<K, V> {
    clear(): void;
    delete(key: K): boolean;
    forEach(callbackfn: (value: V, index: K, map: Map<K, V>) => void, thisArg?: any): void;
    get(key: K): V;
    has(key: K): boolean;
    set(key: K, value: V): Map<K, V>;
    size: number;
    values(): Array<V>;
    keys(): Array<K>;
    entries(): Array<Array<K|V>>;
}
declare var Map: {
    new <K, V>(): Map<K, V>;
    prototype: Map<any, any>;
}
interface Set<T> {
    add(value: T): Set<T>;
    clear(): void;
    delete(value: T): boolean;
    forEach(callbackfn: (value: T, index: T, set: Set<T>) => void, thisArg?: any): void;
    has(value: T): boolean;
    size: number;
    values(): Array<T>;
    keys(): Array<T>;
    entries(): Array<Array<T>>;
}
declare var Set: {
    new <T>(): Set<T>;
    prototype: Set<any>;
}

exports.log = log;
exports.applyMixins = applyMixins;