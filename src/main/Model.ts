var EventEmitter: any = require('events').EventEmitter;

//Model represents a single MFC model, or technically any MFC user whether or
//not that user is a model, admin, guest, basic, premium user, etc.
//
//The Model constructor also serves as a static dictionary of all known models
//which can be accessed via Model.getModel().
//
//Finally, Model emits events when the Model's state is changed.  This is best
//explained via examples.  So see the readme and sample code in MFCAuto_Scripts.
class Model implements NodeJS.EventEmitter {
    uid: number;            //This Model's user id
    [index: string]: any;   //This instance will also serve as an expando dictionary for various properties

    private client: Client;
    truepvt: number;
    guests_muted: number;
    basics_muted: number;
    tags: string[] = [];

    //Instance EventEmitter methods for this specific model.  These are used
    //like:  var m = new Model();  m.on(...);
    //Note that these are not implemented here, we will mixin the correct
    //implementation after this class declaration.
    addListener: (event: string, listener: Function) => NodeJS.EventEmitter;
    on: (event: string, listener: Function) => NodeJS.EventEmitter;
    once: (event: string, listener: Function) => NodeJS.EventEmitter;
    removeListener: (event: string, listener: Function) => NodeJS.EventEmitter;
    removeAllListeners: (event?: string) => NodeJS.EventEmitter;
    setMaxListeners: (n: number) => void;
    listeners: (event: string) => Function[];
    emit: (event: string, ...args: any[]) => boolean;

    //EventEmitter object to be used for events firing for all models
    private static EventsForAllModels: NodeJS.EventEmitter = new EventEmitter();

    //Expose the "all model" events as constructor properies to be accessed
    //like Model.on(...)
    static addListener = Model.EventsForAllModels.addListener;
    static on = Model.EventsForAllModels.on;
    static once = Model.EventsForAllModels.once;
    static removeListener = Model.EventsForAllModels.removeListener;
    static removeAllListeners = Model.EventsForAllModels.removeAllListeners;
    static setMaxListeners = Model.EventsForAllModels.setMaxListeners;
    static listeners = Model.EventsForAllModels.listeners;
    static emit = Model.EventsForAllModels.emit;

    //A registry of all known models that is built up as we receive
    //model information from the server.  This should not be accessed
    //directly.  Use the Model.getModel() method instead.
    private static knownModels: { [index: number]: ExpandedModel } = {};

    //Constructs a new model with the given user id and, optionally, a
    //SESSIONSTATE or TAGS packet containing the initial model details.
    constructor(uid: number, packet?: Packet) {
        this.uid = uid;
        this['vs'] = STATE.Offline; //All model's start as Offline
        if (packet !== undefined) {
            this.client = packet.client;
            this.mergePacket(packet);
        }
    }

    //Retrieves a specific model instance by user id from knownModels, creating
    //the model instance if it does not already exist.
    static getModel(id: any): ExpandedModel {
        if (typeof id === 'string') id = parseInt(id);
        Model.knownModels[id] = Model.knownModels[id] || <ExpandedModel>(new Model(id));
        return Model.knownModels[id];
    }

    //Merges a raw MFC packet into this model's state
    //
    //In short, it cracks open any given Message or FCTypeTagResponse message
    //and adds the members from that message to this instance.  In the case
    //of a SESSIONSTATE packet containing a Message, this method will crack
    //open the UserDetailsMessage, ModelDetailsMessage, and SessionDetailsMessages
    //and add each of their members to this instance at the top level.
    //
    //In other words packet.sMessage.m.camscore will become this.camscore, etc.
    //This may not be the best design, but in practice I've not seen any properties
    //overwritten accidentally and it's been working well for years now.
    //
    //Then this method fires an event for both this Model instance and all Model
    //instances, indicating that the given property has been updated and providing
    //the previous value of the property and the current value of the property.
    //
    //MFC does something a little similar in their site code, check out the
    //StoreUserHash method in their top.html.  In their case they are renaming
    //many of the properties such that "uid" becomes "user_id", for instance.
    //We're not doing that here, which could potentially lead to some confusion
    //if you're comparing a Model instance to how MFC stores users in g_hUsers.
    //But my feeling is that what we're doing here is closer to the actual messages
    //coming from the server, and those are what we deal with in MFCAuto rather
    //than the specific quirks of MFC's own client side abstractions.
    //
    //Finally, there are a few bitmasks that are sent as part of the chat messages.
    //Just like StoreUserHash, we will decode those bitmasks here for convenience
    //as they contain useful information like if a private is true private or
    //if guests or basics are muted.
    mergePacket(packet: Packet): void {
        if (this.client === undefined && packet.client !== undefined) {
            this.client = packet.client;
        }

        var callbackStack: mergeCallbackPayload[] = [];

        switch (packet.FCType) {
            case FCTYPE.SESSIONSTATE:
                assert(this.uid === packet.nArg2, "Merging packet meant for a different model! (" + this.uid + " !== " + packet.nArg2 + ")", packet);

                //This must be typed as any in order to iterate over its keys in a for-in
                //It's real type is Message, but since my type definitions may be incomplete
                //and even if they are complete, MFC may add a new property, we need to
                //iterate over all the keys.
                var payload: any = packet.sMessage;

                for (var key in payload) {
                    //Rip out the sMessage.u|m|s properties and put them on 'this' at
                    //the top level.  This allows for listening on simple event
                    //names like 'rank' or 'camscore'.
                    if (key === "u" || key === "m" || key === "s") {
                        for (var key2 in payload[key]) {
                            callbackStack.push({ prop: key2, oldstate: this[key2], newstate: payload[key][key2] });
                            this[key2] = payload[key][key2];
                            if (key === "m" && key2 === "flags") {
                                this.truepvt = payload[key][key2] & FCOPT.TRUEPVT ? 1 : 0;
                                this.guests_muted = payload[key][key2] & FCOPT.GUESTMUTE ? 1 : 0;
                                this.basics_muted = payload[key][key2] & FCOPT.BASICMUTE ? 1 : 0;
                            }
                        }
                    } else {
                        callbackStack.push({ prop: key, oldstate: this[key], newstate: payload[key] });
                        this[key] = payload[key];
                    }
                }
                break;
            case FCTYPE.TAGS:
                var tagPayload: FCTypeTagsResponse = <FCTypeTagsResponse>packet.sMessage;
                console.assert(tagPayload[this.uid] !== undefined, "This FCTYPE.TAGS messages doesn't appear to be about this model(" + this.uid + "): " + JSON.stringify(tagPayload));
                callbackStack.push({ prop: "tags", oldstate: this.tags, newstate: (this.tags = this.tags.concat(tagPayload[this.uid])) });
                //@TODO - Are tags incrementally added in updates or just given all at once in a single dump??  Not sure, for now
                //we're always adding to any existing tags.  Have to watch if this causes tag duplication or not
                break;
            default:
                throw ("Unknown packet type for: " + packet);
        }

        //After all the changes have been applied, fire our events
        callbackStack.forEach((function(item: mergeCallbackPayload) {
            this.emit(item.prop, this, item.oldstate, item.newstate);
            Model.emit(item.prop, this, item.oldstate, item.newstate);
        }).bind(this));
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

interface mergeCallbackPayload { prop: string; oldstate: number|string|string[]; newstate: number|string|string[] };

applyMixins(Model, [EventEmitter]);

// ExpandedModel is a Model with all the packet details merged at the top level already
interface ExpandedModel extends Model, Message, UserDetailsMessage, ModelDetailsMessage, SessionDetailsMessage { }

exports.Model = Model;
