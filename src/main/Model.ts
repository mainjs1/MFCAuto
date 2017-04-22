import {applyMixins, LogLevel, logWithLevel, decodeIfNeeded} from "./Utils";
import {EventEmitter} from "events";
import {FCTYPE, STATE, FCVIDEO, FCOPT, FCLEVEL} from "./Constants";
import {Message, BaseMessage, ModelDetailsMessage, UserDetailsMessage, SessionDetailsMessage, FCTypeTagsResponse} from "./sMessages";
import * as assert from "assert";

// Model represents a single MFC model, or technically any MFC user whether or
// not that user is a model, admin, guest, basic, premium user, etc.
//
// The Model constructor also serves as a static dictionary of all known models
// which can be accessed via Model.getModel().
//
// Finally, Model emits events when the Model's state is changed.  This is best
// explained via examples.  So see the readme.md
export class Model implements EventEmitter {
    public uid: number;    // This Model's user id
    public nm: string;     // The Model's name
    public tags: string[] = []; // Tags are not session specific

    // Models, and other members, can be logged on more than once. For example, in
    // multiple browsers, etc. In those cases, we'll be getting distinct FCVIDEO
    // state updates from each session. And it's not accurate to report only the
    // most recently seen video state. For example, a model might be in free chat
    // and open another browser window to check her email or current rank. Then
    // she closes the secondary browser window and we get a sessionstate updated
    // saying that second session is now Offline, but she never left cam in her
    // original session. It's incorrect to say she's offline now. So State is not
    // as simple as a single value, and we must track all known sessions for each
    // member.
    //
    // This is a map of SessionID->full state for that session, for all known
    // sessions known for this user.
    //
    // You should be using the .bestSession property to find the most correct
    // session for all-up status reporting.
    private knownSessions: Map<number, ModelSessionDetails> = new Map() as Map<number, ModelSessionDetails>;

    // Instance EventEmitter methods for this specific model.  These are used
    // like:  var m = new Model();  m.on(...);
    // Note that these are not implemented here, we will mixin the correct
    // implementation after this class declaration.
    public addListener: (event: string, listener: ModelEventCallback) => this;
    public on: (event: string, listener: ModelEventCallback) => this;
    public once: (event: string, listener: ModelEventCallback) => this;
    public prependListener: (event: string, listener: ModelEventCallback) => this;
    public prependOnceListener: (event: string, listener: ModelEventCallback) => this;
    public removeListener: (event: string, listener: ModelEventCallback) => this;
    public removeAllListeners: (event?: string) => this;
    public getMaxListeners: () => number;
    public setMaxListeners: (n: number) => this;
    public listeners: (event: string) => ModelEventCallback[];
    public emit: (event: string, ...args: any[]) => boolean;
    public eventNames: () => string[];
    public listenerCount: (type: string) => number;

    // EventEmitter object to be used for events firing for all models
    private static eventsForAllModels: EventEmitter = new EventEmitter();

    // Expose the "all model" events as constructor properies to be accessed
    // like Model.on(...)
    public static addListener = Model.eventsForAllModels.addListener as (event: string, listener: ModelEventCallback) => void;
    public static on = Model.eventsForAllModels.on as (event: string, listener: ModelEventCallback) => void;
    public static once = Model.eventsForAllModels.once as (event: string, listener: ModelEventCallback) => void;
    public static prependListener = Model.eventsForAllModels.prependListener as (event: string, listener: ModelEventCallback) => void;
    public static prependOnceListener = Model.eventsForAllModels.prependOnceListener as (event: string, listener: ModelEventCallback) => void;
    public static removeListener = Model.eventsForAllModels.removeListener as (event: string, listener: ModelEventCallback) => void;
    public static removeAllListeners = Model.eventsForAllModels.removeAllListeners;
    public static getMaxListeners = Model.eventsForAllModels.getMaxListeners;
    public static setMaxListeners = Model.eventsForAllModels.setMaxListeners;
    public static listeners = Model.eventsForAllModels.listeners as (event: string) => ModelEventCallback[];
    public static emit = Model.eventsForAllModels.emit;
    public static eventNames = Model.eventsForAllModels.eventNames;
    public static listenerCount = Model.eventsForAllModels.listenerCount;

    // A registry of all known models that is built up as we receive
    // model information from the server.  This should not be accessed
    // directly.  Use the Model.getModel() method instead.
    private static knownModels: Map<number, Model> = new Map() as Map<number, Model>;

    // Constructs a new model with the given user id
    constructor(uid: number) {
        this.uid = uid;
    }

    // Retrieves a specific model instance by user id from knownModels, creating
    // the model instance if it does not already exist.
    public static getModel(id: any, createIfNecessary: boolean = true): Model | undefined {
        if (typeof id === "string") { id = parseInt(id); }
        if (Model.knownModels.has(id)) {
            return Model.knownModels.get(id);
        } else if (createIfNecessary) {
            Model.knownModels.set(id, new Model(id));
            return Model.knownModels.get(id);
        }
        return undefined;
    }

    // Retrieves a list of models matching the given filter.
    public static findModels(filter: (model: Model) => boolean): Model[] {
        let models: Model[] = [];

        Model.knownModels.forEach((m) => {
            if (filter(m)) {
                models.push(m);
            }
        });

        return models;
    }

    // Similar to MfcSessionManager.prototype.determineBestSession
    // picks the most 'correct' session to use for reporting model status
    // Basically, if model software is being used, pick the session
    // with the highest sessionid among non-offline sessions where
    // model software is being used.  Otherwise, pick the session
    // with the highest sessionid among all non-offline sessions.
    // Otherwise, if all sessions are offline, return 0.
    get bestSessionId(): number {
        let sessionIdToUse: number = 0;
        let foundModelSoftware: boolean = false;
        this.knownSessions.forEach(function (sessionObj, sessionId) {
            if (sessionObj.vs === STATE.Offline) {
                return; // Don't consider offline sessions
            }
            let useThis = false;
            if (sessionObj.model_sw) {
                if (foundModelSoftware) {
                    if (sessionId > sessionIdToUse) {
                        useThis = true;
                    }
                } else {
                    foundModelSoftware = true;
                    useThis = true;
                }
            } else if (!foundModelSoftware && sessionId > sessionIdToUse) {
                useThis = true;
            }
            if (useThis) {
                sessionIdToUse = sessionId;
            }
        });
        return sessionIdToUse;
    }

    get bestSession(): ModelSessionDetails {
        let session = this.knownSessions.get(this.bestSessionId);
        if (session === undefined) {
            session = { sid: 0, uid: this.uid, vs: STATE.Offline };
        }
        return session;
    }

    public mergeTags(newTags: string[]) {
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

    // Merges a raw MFC Message into this model's state
    //
    // Also, there are a few bitmasks that are sent as part of the chat messages.
    // Just like StoreUserHash, we will decode those bitmasks here for convenience
    // as they contain useful information like if a private is true private or
    // if guests or basics are muted or if the model software is being used.
    public merge(msg: Message): void {
        if (!msg) {
            logWithLevel(LogLevel.DEBUG, `[MODEL] merge received an undefined message ${this.uid}`);
            return;
        } else {
            msg = Object.assign({}, msg);
        }

        // Find the session being updated by this message
        let previousSession = this.bestSession;
        let currentSessionId = msg.sid || 0;
        if (!this.knownSessions.has(currentSessionId)) {
            this.knownSessions.set(currentSessionId, { sid: currentSessionId, uid: this.uid, vs: STATE.Offline });
        }
        let currentSession = this.knownSessions.get(currentSessionId) as ModelSessionDetails;

        let callbackStack: mergeCallbackPayload[] = [];

        // Merge the updates into the correct session
        assert.notStrictEqual(msg, undefined);
        assert.ok(msg.lv === undefined || msg.lv === FCLEVEL.MODEL, "Merging a non-model? Non-models need some special casing that is not currently implemented.");
        assert.ok(msg.uid === undefined || this.uid === msg.uid, "Merging a message meant for a different model!: " + JSON.stringify(msg));

        for (let key in msg) {
            // Rip out the sMessage.u|m|s properties and put them on the session at
            // the top level.  This allows for listening on simple event
            // names like 'rank' or 'camscore'.
            if (key === "u" || key === "m" || key === "s") {
                let details = msg[key];
                if (typeof details === "object") {
                    for (let key2 in details) {
                        if (!details.hasOwnProperty(key2)) {
                            continue;
                        }
                        if (typeof details[key2] === "string") {
                            details[key2] = decodeIfNeeded(details[key2]);
                        }
                        callbackStack.push({ prop: key2, oldstate: previousSession[key2], newstate: details[key2] });
                        currentSession[key2] = details[key2];
                        if (key === "m" && key2 === "flags") {
                            currentSession.truepvt = details[key2] & FCOPT.TRUEPVT ? 1 : 0;
                            currentSession.guests_muted = details[key2] & FCOPT.GUESTMUTE ? 1 : 0;
                            currentSession.basics_muted = details[key2] & FCOPT.BASICMUTE ? 1 : 0;
                            currentSession.model_sw = details[key2] & FCOPT.MODELSW ? 1 : 0;
                        }
                    }
                } else {
                    assert.strictEqual(typeof details, "object", "Malformed Message? " + JSON.stringify(msg));
                }
            } else {
                if (typeof msg[key] === "string") {
                    msg[key] = decodeIfNeeded(msg[key]);
                }
                callbackStack.push({ prop: key, oldstate: previousSession[key], newstate: msg[key] });
                currentSession[key] = msg[key];
            }
        }

        // If our "best" session has changed to a new session, the above
        // will capture any changed or added properties, but not the removed
        // properties, so we'll add callbacks for removed properties here...
        if (currentSession.sid !== previousSession.sid) {
            Object.getOwnPropertyNames(previousSession).forEach(function (name) {
                if (!currentSession.hasOwnProperty(name)) {
                    callbackStack.push({ prop: name, oldstate: previousSession[name], newstate: undefined });
                }
            });
        }

        // If, after all the changes have been applied, this new session is our "best" session,
        // fire our change events.
        //
        // Otherwise, if this isn't the "best" session and one we should use for all-up reporting,
        // and the changes are not part of the "last" session (meaning after merging this msg from a real
        // session, if .bestSession is the fake sid===0 session, then this current session was the last
        // online session) then the changes aren't relevant and shouldn't be sent as notifications.
        if (this.bestSessionId === currentSession.sid || (this.bestSessionId === 0 && currentSession.sid !== 0)) {
            if (this.bestSession.nm !== this.nm && this.bestSession.nm !== undefined) {
                // Promote any name changes to a top level property on this
                // This is a mild concession to my .bestSession refactoring in
                // MFCAuto 2.0.0, which fixes the primary break in most of my
                // scripts.
                this.nm = this.bestSession.nm;
            }
            callbackStack.forEach((function (item: mergeCallbackPayload) {
                // But only if the state has changed. Otherwise the event is not really
                // very useful, and, worse, it's very noisy in situations where you have
                // multiple connected Client objects all updating the one true model
                // registry with duplicated SESSIONSTATE events
                if (item.oldstate !== item.newstate) {
                    this.emit(item.prop, this, item.oldstate, item.newstate);
                    Model.emit(item.prop, this, item.oldstate, item.newstate);
                }
            }).bind(this));

            // Also fire a generic ANY event signifying an generic update. This
            // event has different callback arguments than the other Model events,
            // it receives this model instance and the Message that changed the
            // instance.
            this.emit("ANY", this, msg);
            Model.emit("ANY", this, msg);

            // And also process any registered .when callbacks
            this.processWhens(msg);
        }

        this.purgeOldSessions();
    }

    // Don't store sessions forever, older offline sessions will never
    // be our "best" session and we won't use it for anything
    private purgeOldSessions(): void {
        // Session IDs will be in insertion order, first seen to latest (if the implementation follows the ECMAScript spec)
        let sids: Array<number> = Array.from(this.knownSessions.keys());
        let that = this;
        sids.forEach(function (sid) {
            let session = that.knownSessions.get(sid);
            if (session && (session.vs === undefined || session.vs === FCVIDEO.OFFLINE)) {
                that.knownSessions.delete(sid);
            }
        });
    }

    // Purge all session state and start again
    public reset(): void {
        // Set all online sessions that are not the bestSession to offline
        this.knownSessions.forEach((details) => {
            if (details.sid !== this.bestSessionId && details.vs !== FCVIDEO.OFFLINE) {
                details.vs = FCVIDEO.OFFLINE;
            }
        });

        // Merge an empty offline message into bestSession so that all the registered
        // event handlers for .bestSession property changes will be fired and user
        // scripts will have a chance to know they need to re-join rooms, etc, when
        // the connection is restored.
        this.merge({ sid: this.bestSessionId, uid: this.uid, vs: FCVIDEO.OFFLINE });
    }

    // Purge all session state for all models
    public static reset(): void {
        Model.knownModels.forEach((m) => {
            m.reset();
        });
    }

    private static whenMap: Map<whenFilter, whenMapEntry> = new Map() as Map<whenFilter, whenMapEntry>;
    // Registers an onTrue method to be called whenever condition returns true for any model
    // and, optionally, an onFalseAfterTrue method to be called when condition had been true
    // previously but is no longer true
    public static when(condition: whenFilter, onTrue: whenCallback, onFalseAfterTrue?: whenCallback): void {
        Model.whenMap.set(condition, { onTrue: onTrue, onFalseAfterTrue: onFalseAfterTrue, matchedSet: new Set() as Set<number> });
    }
    public static removeWhen(condition: (m: Model) => boolean): boolean {
        return Model.whenMap.delete(condition);
    }

    private whenMap: Map<whenFilter, whenMapEntry> = new Map() as Map<whenFilter, whenMapEntry>;
    // Registers an onTrue method to be called whenever condition returns true for this model
    // and, optionally, an onFalseAfterTrue method to be called when condition had been true
    // previously but is no longer true
    public when(condition: whenFilter, onTrue: whenCallback, onFalseAfterTrue?: whenCallback): void {
        this.whenMap.set(condition, { onTrue: onTrue, onFalseAfterTrue: onFalseAfterTrue, matchedSet: new Set() as Set<number> });
        this.processWhens();
    }
    public removeWhen(condition: (m: Model) => boolean): boolean {
        return this.whenMap.delete(condition);
    }

    private processWhens(payload?: Message | string[]): void {
        let processor = (actions: whenMapEntry, condition: whenFilter) => {
            if (condition(this)) {
                // Only if we weren't previously matching this condition
                if (!actions.matchedSet.has(this.uid)) {
                    actions.matchedSet.add(this.uid);
                    actions.onTrue(this, payload);
                }
            } else {
                // Only if we were previously matching this condition
                // and we have an onFalseAfterTrue callback
                if (actions.matchedSet.delete(this.uid) && actions.onFalseAfterTrue) {
                    actions.onFalseAfterTrue(this, payload);
                }
            }
        };
        this.whenMap.forEach(processor);
        Model.whenMap.forEach(processor);
    }

    public toString(): string {
        return JSON.stringify(this);
    }
}

export type ModelEventCallback = (model: Model, before: number | string | string[] | boolean, after: number | string | string[] | boolean) => void;
export type whenFilter = (m: Model) => boolean;
export type whenCallback = (m: Model, p?: Message | string[]) => void;
interface whenMapEntry {
    onTrue: whenCallback;
    onFalseAfterTrue?: whenCallback;
    matchedSet: Set<number>;
}
interface mergeCallbackPayload { prop: string; oldstate: number | string | string[] | boolean | undefined; newstate: number | string | string[] | boolean | undefined; };
export interface ModelSessionDetails extends BaseMessage, ModelDetailsMessage, UserDetailsMessage, SessionDetailsMessage {
    model_sw?: number;
    truepvt?: number;
    guests_muted?: number;
    basics_muted?: number;
    [index: string]: number | string | boolean | undefined;
}

applyMixins(Model, [EventEmitter]);
