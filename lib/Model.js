"use strict";
var Utils_1 = require("./Utils");
var events_1 = require("events");
var Constants_1 = require("./Constants");
var Constants_2 = require("./Constants");
var Packet_1 = require("./Packet");
var assert = require("assert");
var Model = (function () {
    function Model(uid, packet) {
        this.tags = [];
        this.knownSessions = new Map();
        this.whenMap = new Map();
        this.uid = uid;
        if (packet !== undefined) {
            this.mergePacket(packet);
        }
    }
    Model.getModel = function (id, createIfNecessary) {
        if (createIfNecessary === void 0) { createIfNecessary = true; }
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
    };
    Model.findModels = function (filter) {
        var models = [];
        Model.knownModels.forEach(function (m) {
            if (filter(m)) {
                models.push(m);
            }
        });
        return models;
    };
    Object.defineProperty(Model.prototype, "bestSessionId", {
        get: function () {
            var sessionIdToUse = 0;
            var foundModelSoftware = false;
            this.knownSessions.forEach(function (sessionObj, sessionId) {
                if (sessionObj.vs === Constants_1.STATE.Offline) {
                    return;
                }
                var useThis = false;
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
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Model.prototype, "bestSession", {
        get: function () {
            var session = this.knownSessions.get(this.bestSessionId);
            if (session === undefined) {
                session = { sid: 0, uid: this.uid, vs: Constants_1.STATE.Offline };
            }
            return session;
        },
        enumerable: true,
        configurable: true
    });
    Model.prototype.mergePacket = function (packet) {
        var previousSession = this.bestSession;
        var currentSessionId;
        if (packet.FCType === Constants_1.FCTYPE.TAGS) {
            currentSessionId = previousSession.sid;
        }
        else {
            currentSessionId = packet.sMessage.sid || 0;
        }
        if (!this.knownSessions.has(currentSessionId)) {
            this.knownSessions.set(currentSessionId, { sid: currentSessionId, uid: this.uid, vs: Constants_1.STATE.Offline });
        }
        var currentSession = this.knownSessions.get(currentSessionId);
        var callbackStack = [];
        switch (packet.FCType) {
            case Constants_1.FCTYPE.TAGS:
                var tagPayload = packet.sMessage;
                assert.notStrictEqual(tagPayload[this.uid], undefined, "This FCTYPE.TAGS messages doesn't appear to be about this model(" + this.uid + "): " + JSON.stringify(tagPayload));
                callbackStack.push({ prop: "tags", oldstate: this.tags, newstate: (this.tags = this.tags.concat(tagPayload[this.uid])) });
                break;
            default:
                var payload = packet.sMessage;
                assert.notStrictEqual(payload, undefined);
                assert.ok(payload.lv === undefined || payload.lv === 4, "Merging a non-model? Non-models need some special casing that is not currently implemented.");
                assert.ok((payload.uid !== undefined && this.uid === payload.uid) || (packet.aboutModel && packet.aboutModel.uid === this.uid), "Merging a packet meant for a different model!: " + packet.toString());
                for (var key in payload) {
                    if (key === "u" || key === "m" || key === "s") {
                        for (var key2 in payload[key]) {
                            if (!payload[key].hasOwnProperty(key2)) {
                                continue;
                            }
                            callbackStack.push({ prop: key2, oldstate: previousSession[key2], newstate: payload[key][key2] });
                            currentSession[key2] = payload[key][key2];
                            if (key === "m" && key2 === "flags") {
                                currentSession.truepvt = payload[key][key2] & Constants_2.FCOPT.TRUEPVT ? 1 : 0;
                                currentSession.guests_muted = payload[key][key2] & Constants_2.FCOPT.GUESTMUTE ? 1 : 0;
                                currentSession.basics_muted = payload[key][key2] & Constants_2.FCOPT.BASICMUTE ? 1 : 0;
                                currentSession.model_sw = payload[key][key2] & Constants_2.FCOPT.MODELSW ? 1 : 0;
                            }
                        }
                    }
                    else {
                        callbackStack.push({ prop: key, oldstate: previousSession[key], newstate: payload[key] });
                        currentSession[key] = payload[key];
                    }
                }
                break;
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
            this.emit("ANY", this, packet);
            Model.emit("ANY", this, packet);
            this.processWhens(packet);
        }
        this.purgeOldSessions();
    };
    Model.prototype.purgeOldSessions = function () {
        var sids = Array.from(this.knownSessions.keys());
        var that = this;
        sids.forEach(function (sid) {
            if (that.knownSessions.get(sid).vs === undefined || that.knownSessions.get(sid).vs === Constants_2.FCVIDEO.OFFLINE) {
                that.knownSessions.delete(sid);
            }
        });
    };
    Model.prototype.reset = function () {
        var _this = this;
        this.knownSessions.forEach(function (details) {
            if (details.sid !== _this.bestSessionId && details.vs !== Constants_2.FCVIDEO.OFFLINE) {
                details.vs = Constants_2.FCVIDEO.OFFLINE;
            }
        });
        var blank = new Packet_1.Packet(Constants_1.FCTYPE.SESSIONSTATE, 0, 0, 0, 0, 0, { sid: this.bestSessionId, uid: this.uid, vs: Constants_2.FCVIDEO.OFFLINE });
        this.mergePacket(blank);
    };
    Model.reset = function () {
        Model.knownModels.forEach(function (m) {
            m.reset();
        });
    };
    Model.when = function (condition, onTrue, onFalseAfterTrue) {
        Model.whenMap.set(condition, { onTrue: onTrue, onFalseAfterTrue: onFalseAfterTrue, matchedSet: new Set() });
    };
    Model.removeWhen = function (condition) {
        return Model.whenMap.delete(condition);
    };
    Model.prototype.when = function (condition, onTrue, onFalseAfterTrue) {
        this.whenMap.set(condition, { onTrue: onTrue, onFalseAfterTrue: onFalseAfterTrue, matchedSet: new Set() });
        this.processWhens();
    };
    Model.prototype.removeWhen = function (condition) {
        return this.whenMap.delete(condition);
    };
    Model.prototype.processWhens = function (packet) {
        var _this = this;
        var processor = function (actions, condition) {
            if (condition(_this)) {
                if (!actions.matchedSet.has(_this.uid)) {
                    actions.matchedSet.add(_this.uid);
                    actions.onTrue(_this, packet);
                }
            }
            else {
                if (actions.matchedSet.delete(_this.uid) && actions.onFalseAfterTrue) {
                    actions.onFalseAfterTrue(_this, packet);
                }
            }
        };
        this.whenMap.forEach(processor);
        Model.whenMap.forEach(processor);
    };
    Model.prototype.toString = function () {
        return JSON.stringify(this);
    };
    return Model;
}());
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