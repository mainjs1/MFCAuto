import {AnyMessage, RoomDataMessage, Message, FCTokenIncResponse} from "./sMessages";
import {Client} from "./Client";
import {FCTYPE} from "./Constants";
import {logWithLevel, LogLevel} from "./Utils";
import {Model} from "./Model";

// Forward definitions for the TypeScript compiler
declare var escape: (text: string) => string;
declare var unescape: (text: string) => string;

// Packet represents a single, complete message received from the chat server
export class Packet {
    public readonly FCType: FCTYPE;     // The message type
    public readonly nFrom: number;      // Who sent the message (unclear what this actually represents, but it looks like a session id)
    public readonly nTo: number;        // Who the message is for (almost always your own session id)
    public readonly nArg1: number;      // Variable argument 1 (unclear usage in practice)
    public readonly nArg2: number;      // Variable argument 2 (if the packet is about a model, updating her state or room title for instance, this value will be the model's user id)
    public readonly sPayload: number;   // Payload size
    public readonly sMessage: AnyMessage | undefined;      // The actual payload

    // Property backing fields
    private _aboutModel: Model | undefined;
    private _pMessage: string | undefined;
    private _chatString: string;

    constructor(FCType: FCTYPE, nFrom: number, nTo: number, nArg1: number, nArg2: number, sPayload: number, sMessage: AnyMessage | undefined) {
        this.FCType = FCType;
        this.nFrom = nFrom;
        this.nTo = nTo;
        this.nArg1 = nArg1;
        this.nArg2 = nArg2;
        this.sPayload = sPayload;
        this.sMessage = sMessage;
    }

    // Try to determine which model this packet is loosely "about"
    // meaning whose receiving the tip/chat/status update/etc
    get aboutModel(): Model | undefined {
        if (this._aboutModel === undefined) {
            let id = -1;
            switch (this.FCType) {
                case FCTYPE.ADDFRIEND:
                case FCTYPE.ADDIGNORE:
                case FCTYPE.JOINCHAN:
                case FCTYPE.STATUS:
                case FCTYPE.CHATFLASH:
                case FCTYPE.ZBAN:
                    id = this.nArg1;
                    break;
                case FCTYPE.SESSIONSTATE:
                case FCTYPE.LISTCHAN:
                    id = this.nArg2;
                    break;
                case FCTYPE.USERNAMELOOKUP:
                case FCTYPE.NEWSITEM:
                case FCTYPE.PMESG:
                    id = this.nFrom;
                    break;
                case FCTYPE.GUESTCOUNT:
                case FCTYPE.TOKENINC:
                case FCTYPE.CMESG:
                case FCTYPE.BANCHAN:
                    id = this.nTo;
                    break;
                case FCTYPE.ROOMDATA:
                    let rdm = this.sMessage as RoomDataMessage;
                    if (rdm !== undefined && rdm.model !== undefined) {
                        id = rdm.model;
                    }
                    break;
                case FCTYPE.LOGIN:
                case FCTYPE.MODELGROUP:
                case FCTYPE.PRIVACY:
                case FCTYPE.DETAILS:
                case FCTYPE.METRICS:
                case FCTYPE.UEOPT:
                case FCTYPE.SLAVEVSHARE:
                case FCTYPE.INBOX:
                case FCTYPE.EXTDATA:
                case FCTYPE.MYWEBCAM:
                case FCTYPE.TAGS:
                case FCTYPE.NULL:
                    // These cases don't have a direct mapping between packet and model.
                    // either the mapping doesn't apply or this packet is about many models
                    // potentially (like Tags packets)
                    id = -1;
                    break;
                default:
                    // @TODO - Fill in the rest of the cases as necessary
                    // assert.fail(`Tried to retrieve an aboutModel for unknown packet type: ${this.toString()}`);
            }
            id = Client.toUserId(id);
            this._aboutModel = Model.getModel(id);
        }

        return this._aboutModel;
    }

    // This parses MFC's emote encoding and replaces those tokens with the simple
    // emote code like ":wave".  Design intent is not for this function to be
    // called directly, but rather for the decoded string to be accessed through
    // the pMessage property, which has the beneficial side-effect of caching the
    // result for faster repeated access.
    private _parseEmotes(msg: string): string | undefined {
        try {
            msg = unescape(msg);

            //  image parsing
            let nParseLimit = 0;

            //  This regex is directly from mfccore.js, ParseEmoteOutput.prototype.Parse, with the same letiable name etc
            let oImgRegExPattern = /#~(e|c|u|ue),(\w+)(\.?)(jpeg|jpg|gif|png)?,([\w\-\:\);\(\]\=\$\?\*]{0,48}),?(\d*),?(\d*)~#/;

            let re: any = [];
            // tslint:disable:no-conditional-assignment
            while ((re = msg.match(oImgRegExPattern)) && nParseLimit < 10) {
                let sShortcut = re[5] || "";

                if (sShortcut) {
                    sShortcut = ":" + sShortcut;
                } else {
                    sShortcut = "<UNKNOWN EMOTE CODE: " + msg + ">";
                }

                msg = msg.replace(oImgRegExPattern, sShortcut);

                nParseLimit++;
            }

            return msg;
        } catch (e) {
            // In practice I've never seen this happen, but if it does, it's not serious enough to tear down the whole client...
            logWithLevel(LogLevel.WARNING, "Error parsing emotes from '" + msg + "': " + e);
            return undefined;
        }
    }

    // Returns the formatted text of chat, PM, or tip messages.  For instance
    // the raw sMessage.msg string may be something like:
    //   "I am happy #~ue,2c9d2da6.gif,mhappy~#"
    // This returns that in the more human readable format:
    //   "I am happy :mhappy"
    public get pMessage(): string | undefined {
        // Formats the parsed message component of this packet, if one exists, with decoded emotes
        if (this._pMessage === undefined && typeof this.sMessage === "object") {
            if (this.FCType === FCTYPE.CMESG || this.FCType === FCTYPE.PMESG || this.FCType === FCTYPE.TOKENINC) {
                let obj: Message = this.sMessage as Message;
                if (obj && obj.msg) {
                    this._pMessage = this._parseEmotes(obj.msg);
                }
            }
        }
        return this._pMessage;
    }

    // For chat, PM, or tip messages, this property returns the text of the
    // message as it would appear in the MFC chat window with the username
    // prepended, etc:
    //
    //   AspenRae: Thanks guys! :mhappy
    //
    // This is useful for logging.
    public get chatString(): string {
        if (this._chatString === undefined) {
            if (this.sMessage && typeof this.sMessage === "object") {
                switch (this.FCType) {
                    case FCTYPE.CMESG:
                    case FCTYPE.PMESG:
                        let msg: Message = this.sMessage as Message;
                        this._chatString = msg.nm + ": " + this.pMessage;
                        break;
                    case FCTYPE.TOKENINC:
                        let tok: FCTokenIncResponse = this.sMessage as FCTokenIncResponse;
                        this._chatString = tok.u[2] + " has tipped " + tok.m[2] + " " + tok.tokens + " tokens" + (this.pMessage ? (": '" + this.pMessage + "'") : ".");
                        break;
                    default:
                        break;
                }
            }
        }

        return this._chatString;
    }

    public toString(): string {
        function censor(key: string, value: any) {
            if (key === "FCType") {
                // Replace the numerical FCType value with it's more readable textual form
                return FCTYPE[this.FCType];
            }
            return value;
        }
        return JSON.stringify(this, censor);
    }
}
