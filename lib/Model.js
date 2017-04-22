"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Utils_1 = require("./Utils");
const events_1 = require("events");
const Constants_1 = require("./Constants");
const assert = require("assert");
class Model {
    constructor(uid) {
        this.tags = [];
        this.knownSessions = new Map();
        this.whenMap = new Map();
        this.uid = uid;
    }
    static getModel(id, createIfNecessary = true) {
        if (typeof id === "string") {
            id = parseInt(id);
        }
        if (Model.knownModels.has(id)) {
            return Model.knownModels.get(id);
        }
        else if (createIfNecessary) {
            Model.knownModels.set(id, new Model(id));
            return Model.knownModels.get(id);
        }
        return undefined;
    }
    static findModels(filter) {
        let models = [];
        Model.knownModels.forEach((m) => {
            if (filter(m)) {
                models.push(m);
            }
        });
        return models;
    }
    get bestSessionId() {
        let sessionIdToUse = 0;
        let foundModelSoftware = false;
        this.knownSessions.forEach(function (sessionObj, sessionId) {
            if (sessionObj.vs === Constants_1.STATE.Offline) {
                return;
            }
            let useThis = false;
            if (sessionObj.model_sw) {
                if (foundModelSoftware) {
                    if (sessionId > sessionIdToUse) {
                        useThis = true;
                    }
                }
                else {
                    foundModelSoftware = true;
                    useThis = true;
                }
            }
            else if (!foundModelSoftware && sessionId > sessionIdToUse) {
                useThis = true;
            }
            if (useThis) {
                sessionIdToUse = sessionId;
            }
        });
        return sessionIdToUse;
    }
    get bestSession() {
        let session = this.knownSessions.get(this.bestSessionId);
        if (session === undefined) {
            session = { sid: 0, uid: this.uid, vs: Constants_1.STATE.Offline };
        }
        return session;
    }
    mergeTags(newTags) {
        if (Array.isArray(newTags)) {
            let oldTags = this.tags.slice();
            this.tags = this.tags.concat(newTags);
            this.emit("tags", this, oldTags, this.tags);
            Model.emit("tags", this, oldTags, this.tags);
            this.emit("ANY", this, oldTags, this.tags);
            Model.emit("ANY", this, oldTags, this.tags);
            this.processWhens(newTags);
        }
    }
    merge(msg) {
        if (!msg) {
            Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[MODEL] merge received an undefined message ${this.uid}`);
            return;
        }
        else {
            msg = Object.assign({}, msg);
        }
        let previousSession = this.bestSession;
        let currentSessionId = msg.sid || 0;
        if (!this.knownSessions.has(currentSessionId)) {
            this.knownSessions.set(currentSessionId, { sid: currentSessionId, uid: this.uid, vs: Constants_1.STATE.Offline });
        }
        let currentSession = this.knownSessions.get(currentSessionId);
        let callbackStack = [];
        assert.notStrictEqual(msg, undefined);
        assert.ok(msg.lv === undefined || msg.lv === Constants_1.FCLEVEL.MODEL, "Merging a non-model? Non-models need some special casing that is not currently implemented.");
        assert.ok(msg.uid === undefined || this.uid === msg.uid, "Merging a message meant for a different model!: " + JSON.stringify(msg));
        for (let key in msg) {
            if (key === "u" || key === "m" || key === "s") {
                let details = msg[key];
                if (typeof details === "object") {
                    for (let key2 in details) {
                        if (!details.hasOwnProperty(key2)) {
                            continue;
                        }
                        if (typeof details[key2] === "string") {
                            details[key2] = Utils_1.decodeIfNeeded(details[key2]);
                        }
                        callbackStack.push({ prop: key2, oldstate: previousSession[key2], newstate: details[key2] });
                        currentSession[key2] = details[key2];
                        if (key === "m" && key2 === "flags") {
                            currentSession.truepvt = details[key2] & Constants_1.FCOPT.TRUEPVT ? 1 : 0;
                            currentSession.guests_muted = details[key2] & Constants_1.FCOPT.GUESTMUTE ? 1 : 0;
                            currentSession.basics_muted = details[key2] & Constants_1.FCOPT.BASICMUTE ? 1 : 0;
                            currentSession.model_sw = details[key2] & Constants_1.FCOPT.MODELSW ? 1 : 0;
                        }
                    }
                }
                else {
                    assert.strictEqual(typeof details, "object", "Malformed Message? " + JSON.stringify(msg));
                }
            }
            else {
                if (typeof msg[key] === "string") {
                    msg[key] = Utils_1.decodeIfNeeded(msg[key]);
                }
                callbackStack.push({ prop: key, oldstate: previousSession[key], newstate: msg[key] });
                currentSession[key] = msg[key];
            }
        }
        if (currentSession.sid !== previousSession.sid) {
            Object.getOwnPropertyNames(previousSession).forEach(function (name) {
                if (!currentSession.hasOwnProperty(name)) {
                    callbackStack.push({ prop: name, oldstate: previousSession[name], newstate: undefined });
                }
            });
        }
        if (this.bestSessionId === currentSession.sid || (this.bestSessionId === 0 && currentSession.sid !== 0)) {
            if (this.bestSession.nm !== this.nm && this.bestSession.nm !== undefined) {
                this.nm = this.bestSession.nm;
            }
            callbackStack.forEach((function (item) {
                if (item.oldstate !== item.newstate) {
                    this.emit(item.prop, this, item.oldstate, item.newstate);
                    Model.emit(item.prop, this, item.oldstate, item.newstate);
                }
            }).bind(this));
            this.emit("ANY", this, msg);
            Model.emit("ANY", this, msg);
            this.processWhens(msg);
        }
        this.purgeOldSessions();
    }
    purgeOldSessions() {
        let sids = Array.from(this.knownSessions.keys());
        let that = this;
        sids.forEach(function (sid) {
            let session = that.knownSessions.get(sid);
            if (session && (session.vs === undefined || session.vs === Constants_1.FCVIDEO.OFFLINE)) {
                that.knownSessions.delete(sid);
            }
        });
    }
    reset() {
        this.knownSessions.forEach((details) => {
            if (details.sid !== this.bestSessionId && details.vs !== Constants_1.FCVIDEO.OFFLINE) {
                details.vs = Constants_1.FCVIDEO.OFFLINE;
            }
        });
        this.merge({ sid: this.bestSessionId, uid: this.uid, vs: Constants_1.FCVIDEO.OFFLINE });
    }
    static reset() {
        Model.knownModels.forEach((m) => {
            m.reset();
        });
    }
    static when(condition, onTrue, onFalseAfterTrue) {
        Model.whenMap.set(condition, { onTrue: onTrue, onFalseAfterTrue: onFalseAfterTrue, matchedSet: new Set() });
    }
    static removeWhen(condition) {
        return Model.whenMap.delete(condition);
    }
    when(condition, onTrue, onFalseAfterTrue) {
        this.whenMap.set(condition, { onTrue: onTrue, onFalseAfterTrue: onFalseAfterTrue, matchedSet: new Set() });
        this.processWhens();
    }
    removeWhen(condition) {
        return this.whenMap.delete(condition);
    }
    processWhens(payload) {
        let processor = (actions, condition) => {
            if (condition(this)) {
                if (!actions.matchedSet.has(this.uid)) {
                    actions.matchedSet.add(this.uid);
                    actions.onTrue(this, payload);
                }
            }
            else {
                if (actions.matchedSet.delete(this.uid) && actions.onFalseAfterTrue) {
                    actions.onFalseAfterTrue(this, payload);
                }
            }
        };
        this.whenMap.forEach(processor);
        Model.whenMap.forEach(processor);
    }
    toString() {
        return JSON.stringify(this);
    }
}
Model.eventsForAllModels = new events_1.EventEmitter();
Model.addListener = Model.eventsForAllModels.addListener;
Model.on = Model.eventsForAllModels.on;
Model.once = Model.eventsForAllModels.once;
Model.prependListener = Model.eventsForAllModels.prependListener;
Model.prependOnceListener = Model.eventsForAllModels.prependOnceListener;
Model.removeListener = Model.eventsForAllModels.removeListener;
Model.removeAllListeners = Model.eventsForAllModels.removeAllListeners;
Model.getMaxListeners = Model.eventsForAllModels.getMaxListeners;
Model.setMaxListeners = Model.eventsForAllModels.setMaxListeners;
Model.listeners = Model.eventsForAllModels.listeners;
Model.emit = Model.eventsForAllModels.emit;
Model.eventNames = Model.eventsForAllModels.eventNames;
Model.listenerCount = Model.eventsForAllModels.listenerCount;
Model.knownModels = new Map();
Model.whenMap = new Map();
exports.Model = Model;
;
Utils_1.applyMixins(Model, [events_1.EventEmitter]);
//# sourceMappingURL=Model.js.map