/* @internal */
var EventEmitter: any = require('events').EventEmitter;

//Model represents a single MFC model, or technically any MFC user whether or
//not that user is a model, admin, guest, basic, premium user, etc.
//
//The Model constructor also serves as a static dictionary of all known models
//which can be accessed via Model.getModel().
//
//Finally, Model emits events when the Model's state is changed.  This is best
//explained via examples.  So see the readme.md
class Model implements NodeJS.EventEmitter {
    uid: number;    //This Model's user id
    nm: string;     //The Model's name
    tags: string[] = []; //Tags are not session specific
    private client: Client;

    //Models, and other members, can be logged on more than once. For example, in
    //multiple browsers, etc. In those cases, we'll be getting distinct FCVIDEO
    //state updates from each session. And it's not accurate to report only the
    //most recently seen video state. For example, a model might be in free chat
    //and open another browser window to check her email or current rank. Then
    //she closes the secondary browser window and we get a sessionstate updated
    //saying that second session is now Offline, but she never left cam in her
    //original session. It's incorrect to say she's offline now. So State is not
    //as simple as a single value, and we must track all known sessions for each
    //member.
    //
    //This is a map of SessionID->full state for that session, for all known
    //sessions known for this user.
    //
    //You should be using the .bestSession property to find the most correct
    //session for all-up status reporting.
    knownSessions: Map<number, ModelSessionDetails> = <Map<number, ModelSessionDetails>>new Map();

    //Instance EventEmitter methods for this specific model.  These are used
    //like:  var m = new Model();  m.on(...);
    //Note that these are not implemented here, we will mixin the correct
    //implementation after this class declaration.
    addListener: (event: string, listener: Function) => this;
    on: (event: string, listener: Function) => this;
    once: (event: string, listener: Function) => this;
    removeListener: (event: string, listener: Function) => this;
    removeAllListeners: (event?: string) => this;
    getMaxListeners: () => number;
    setMaxListeners: (n: number) => this;
    listeners: (event: string) => Function[];
    emit: (event: string, ...args: any[]) => boolean;
    listenerCount: (type: string) => number;

    //EventEmitter object to be used for events firing for all models
    private static EventsForAllModels: NodeJS.EventEmitter = new EventEmitter();

    //Expose the "all model" events as constructor properies to be accessed
    //like Model.on(...)
    static addListener = Model.EventsForAllModels.addListener;
    static on = Model.EventsForAllModels.on;
    static once = Model.EventsForAllModels.once;
    static removeListener = Model.EventsForAllModels.removeListener;
    static removeAllListeners = Model.EventsForAllModels.removeAllListeners;
    static getMaxListeners = Model.EventsForAllModels.getMaxListeners;
    static setMaxListeners = Model.EventsForAllModels.setMaxListeners;
    static listeners = Model.EventsForAllModels.listeners;
    static emit = Model.EventsForAllModels.emit;
    static listenerCount = Model.EventsForAllModels.listenerCount;

    //A registry of all known models that is built up as we receive
    //model information from the server.  This should not be accessed
    //directly.  Use the Model.getModel() method instead.
    private static knownModels: { [index: number]: Model } = {};

    //Constructs a new model with the given user id and, optionally, a
    //SESSIONSTATE or TAGS packet containing the initial model details.
    constructor(uid: number, packet?: Packet) {
        this.uid = uid;
        if (packet !== undefined) {
            this.client = packet.client;
            this.mergePacket(packet);
        }
    }

    //Retrieves a specific model instance by user id from knownModels, creating
    //the model instance if it does not already exist.
    static getModel(id: any, createIfNecessary: boolean = true): Model {
        if (typeof id === 'string') id = parseInt(id);
        if (createIfNecessary) {
            Model.knownModels[id] = Model.knownModels[id] || <Model>(new Model(id));
        }
        return Model.knownModels[id];
    }

    //Retrieves a list of models matching the given filter.
    static findModels(filter: (model: Model) => boolean): Model[] {
        let models: Model[] = [];

        for (let id in Model.knownModels) {
            if (Model.knownModels.hasOwnProperty(id)) {
                if (filter(Model.knownModels[id])) {
                    models.push(Model.knownModels[id]);
                }
            }
        }

        return models;
    }

    //Similar to MfcSessionManager.prototype.determineBestSession
    //picks the most 'correct' session to use for reporting model status
    //Basically, if model software is being used, pick the session
    //with the highest sessionid among non-offline sessions where
    //model software is being used.  Otherwise, pick the session
    //with the highest sessionid among all non-offline sessions.
    //Otherwise, if all sessions are offline, return 0.
    get bestSessionId(): number {
        let sessionIdToUse: number = 0;
        let foundModelSoftware: boolean = false;
        this.knownSessions.forEach(function(sessionObj, sessionId) {
            if (sessionObj.vs === STATE.Offline) {
                return; //Don't consider offline sessions
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

    //Merges a raw MFC packet into this model's state
    //
    //Also, there are a few bitmasks that are sent as part of the chat messages.
    //Just like StoreUserHash, we will decode those bitmasks here for convenience
    //as they contain useful information like if a private is true private or
    //if guests or basics are muted or if the model software is being used.
    mergePacket(packet: Packet): void {
        if (this.client === undefined && packet.client !== undefined) {
            this.client = packet.client;
        }

        //Find the session being updated by this packet
        let previousSession = this.bestSession;
        let currentSessionId: number;
        if (packet.FCType === FCTYPE.TAGS) {
            //Special case TAGS packets, because they don't contain a sessionID
            //So just fake that we're talking about the previously known best session
            currentSessionId = previousSession.sid;
        } else {
            currentSessionId = (<Message>packet.sMessage).sid || 0;
        }
        if (!this.knownSessions.has(currentSessionId)) {
            this.knownSessions.set(currentSessionId, { sid: currentSessionId, uid: this.uid, vs: STATE.Offline });
        }
        let currentSession = this.knownSessions.get(currentSessionId);

        var callbackStack: mergeCallbackPayload[] = [];

        //Merge the updates into the correct session
        switch (packet.FCType) {
            case FCTYPE.TAGS:
                var tagPayload: FCTypeTagsResponse = <FCTypeTagsResponse>packet.sMessage;
                assert.notStrictEqual(tagPayload[this.uid], undefined, "This FCTYPE.TAGS messages doesn't appear to be about this model(" + this.uid + "): " + JSON.stringify(tagPayload));
                callbackStack.push({ prop: "tags", oldstate: this.tags, newstate: (this.tags = this.tags.concat(tagPayload[this.uid])) });
                //@TODO - Are tags incrementally added in updates or just given all at once in a single dump??  Not sure, for now
                //we're always adding to any existing tags.  Have to watch if this causes tag duplication or not
                break;
            default:
                //This must be typed as any in order to iterate over its keys in a for-in
                //It's real type is Message, but since my type definitions may be incomplete
                //and even if they are complete, MFC may add a new property, we need to
                //iterate over all the keys.
                var payload: any = packet.sMessage;
                assert.notStrictEqual(payload, undefined);
                assert.ok(payload.lv === undefined || payload.lv === 4, "Merging a non-model? Non-models need some special casing that is not currently implemented.");
                assert.ok((payload.uid !== undefined && this.uid === payload.uid) || packet.aboutModel.uid === this.uid, "Merging a packet meant for a different model!: " + packet.toString());

                for (var key in payload) {
                    //Rip out the sMessage.u|m|s properties and put them on the session at
                    //the top level.  This allows for listening on simple event
                    //names like 'rank' or 'camscore'.
                    if (key === "u" || key === "m" || key === "s") {
                        for (var key2 in payload[key]) {
                            callbackStack.push({ prop: key2, oldstate: previousSession[key2], newstate: payload[key][key2] });
                            currentSession[key2] = payload[key][key2];
                            if (key === "m" && key2 === "flags") {
                                currentSession.truepvt = payload[key][key2] & FCOPT.TRUEPVT ? 1 : 0;
                                currentSession.guests_muted = payload[key][key2] & FCOPT.GUESTMUTE ? 1 : 0;
                                currentSession.basics_muted = payload[key][key2] & FCOPT.BASICMUTE ? 1 : 0;
                                currentSession.model_sw = payload[key][key2] & FCOPT.MODELSW ? 1 : 0;
                            }
                        }
                    } else {
                        callbackStack.push({ prop: key, oldstate: previousSession[key], newstate: payload[key] });
                        currentSession[key] = payload[key];
                    }
                }
                break;
        }

        //If our "best" session has changed to a new session, the above
        //will capture any changed or added properties, but not the removed
        //properties, so we'll add callbacks for removed properties here...
        if (currentSession.sid !== previousSession.sid) {
            Object.getOwnPropertyNames(previousSession).forEach(function(name) {
                if (!currentSession.hasOwnProperty(name)) {
                    callbackStack.push({ prop: name, oldstate: previousSession[name], newstate: undefined });
                }
            });
        }

        //If, after all the changes have been applied, this new session is our "best" session,
        //fire our change events.
        //
        //Otherwise, if this isn't the "best" session and one we should use for all-up reporting,
        //and they're not part of the "last" session (meaning after merging this packet from a real
        //session, if .bestSession is the fake sid===0 session, then this current session was the last
        //online session) then the changes aren't relevant and shouldn't be sent as notifications.
        if (this.bestSessionId === currentSession.sid || (this.bestSessionId === 0 && currentSession.sid !== 0)) {
            if (this.bestSession.nm !== this.nm && this.bestSession.nm !== undefined) {
                //Promote any name changes to a top level property on this
                //This is a mild concession to my .bestSession refactoring in
                //MFCAuto 2.0.0, which fixes the primary break in most of my
                //scripts.
                this.nm = this.bestSession.nm;
            }
            callbackStack.forEach((function(item: mergeCallbackPayload) {
                //But only if the state has changed. Otherwise the event is not really
                //very useful, and, worse, it's very noisy in situations where you have
                //multiple connected Client objects all updating the one true model
                //registry with duplicated SESSIONSTATE events
                if (item.oldstate !== item.newstate) {
                    this.emit(item.prop, this, item.oldstate, item.newstate);
                    Model.emit(item.prop, this, item.oldstate, item.newstate);
                }
            }).bind(this));
        }

        this.purgeOldSessions();
    }

    //Don't store sessions forever, older offline sessions will never
    //be our "best" session and we won't use it for anything
    private purgeOldSessions(): void {
        let sids: Array<number> = (<any>Array).from(this.knownSessions.keys); //Session IDs will be in insertion order, first seen to latest (if the implementation follows the ECMAScript spec)
        let that = this;
        sids.forEach(function(sid) {
            if (that.knownSessions.get(sid).vs === undefined || that.knownSessions.get(sid).vs === FCVIDEO.OFFLINE) {
                that.knownSessions.delete(sid);
            }
        });
    }

    toString(): string {
        function censor(key: string, value: any) {
            if (key === "client") {
                //This would lead to a circular reference
                return undefined;
            }
            return value;
        }
        return JSON.stringify(this, censor);
    }
}

interface mergeCallbackPayload { prop: string; oldstate: number | string | string[] | boolean; newstate: number | string | string[] | boolean };
interface ModelSessionDetails extends BaseMessage, ModelDetailsMessage, UserDetailsMessage, SessionDetailsMessage {
    model_sw?: number;
    truepvt?: number;
    guests_muted?: number;
    basics_muted?: number;
    [index: string]: number|string|boolean;
}

applyMixins(Model, [EventEmitter]);

exports.Model = Model;
