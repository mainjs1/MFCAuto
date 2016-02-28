//Forward definitions for the TypeScript compiler
interface escape {
    (text: string): string;
}
declare var escape: escape;
declare var unescape: escape;


//Packet represents a single, complete message received from the chat server
class Packet {
    client: Client;
    FCType: FCTYPE;     //The message type
    nFrom: number;      //Who sent the message (unclear what this actually represents, but it looks like a session id)
    nTo: number;        //Who the message is for (almost always your own session id)
    nArg1: number;      //Variable argument 1 (unclear usage in practice)
    nArg2: number;      //Variable argument 2 (if the packet is about a model, updating her state or room title for instance, this value will be the model's user id)
    sPayload: number;   //Payload size
    sMessage: AnyMessage;      //The actual payload

    //Property backing fields
    private _aboutModel: Model;
    private _pMessage: string;
    private _chatString: string;

    constructor(client: Client, FCType: FCTYPE, nFrom: number, nTo: number, nArg1: number, nArg2: number, sPayload: number, sMessage: AnyMessage) {
        this.client = client; //@TODO - Break this circular reference, for now it's used in .aboutModel

        this.FCType = FCType;
        this.nFrom = nFrom;
        this.nTo = nTo;
        this.nArg1 = nArg1;
        this.nArg2 = nArg2;
        this.sPayload = sPayload;
        this.sMessage = sMessage;
    }

    //Try to determine which model this packet is loosely "about"
    //meaning whose receiving the tip/chat/status update/etc
    get aboutModel(): Model {
        if (this._aboutModel === undefined) {
            let id = -1;
            switch (this.FCType) {
                case FCTYPE.ADDFRIEND:
                case FCTYPE.ADDIGNORE:
                case FCTYPE.JOINCHAN:
                case FCTYPE.STATUS:
                case FCTYPE.CHATFLASH:
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
                    id = this.nTo;
                    break;
                case FCTYPE.ROOMDATA:
                    let rdm = <RoomDataMessage>this.sMessage;
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
                    //These cases don't have a direct mapping between packet and model.
                    //either the mapping doesn't apply or this packet is about many models
                    //potentially (like Tags packets)
                    id = -1;
                    break;
                default:
                    //@TODO - Fill in the rest of the cases as necessary
                    //assert.fail(`Tried to retrieve an aboutModel for unknown packet type: ${this.toString()}`);
            }
            id = Client.toUserId(id);
            this._aboutModel = Model.getModel(id);
        }

        return this._aboutModel;
    }

    //This parses MFC's emote encoding and replaces those tokens with the simple
    //emote code like ":wave".  Design intent is not for this function to be
    //called directly, but rather for the decoded string to be accessed through
    //the pMessage property, which has the beneficial side-effect of caching the
    //result for faster repeated access.
    private _parseEmotes(msg: string): string {
        try {
            msg = unescape(msg);

            // image parsing
            var nParseLimit = 0;

            // This regex is directly from mfccore.js, ParseEmoteOutput.prototype.Parse, with the same variable name etc
            var oImgRegExPattern = /#~(e|c|u|ue),(\w+)(\.?)(jpeg|jpg|gif|png)?,([\w\-\:\);\(\]\=\$\?\*]{0,48}),?(\d*),?(\d*)~#/;

            var re: any = [];
            while ((re = msg.match(oImgRegExPattern)) && nParseLimit < 10) {
                var sShortcut = re[5] || '';

                if (sShortcut) {
                    sShortcut = ':' + sShortcut;
                } else {
                    sShortcut = "<UNKNOWN EMOTE CODE: " + msg + ">";
                }

                msg = msg.replace(oImgRegExPattern, sShortcut);

                nParseLimit++;
            }

            return msg;
        } catch (e) {
            //In practice I've never seen this happen, but if it does, it's not serious enough to tear down the whole client...
            log("Error parsing emotes from '" + msg + "': " + e);
            return undefined;
        }
    }

    //Returns the formatted text of chat, PM, or tip messages.  For instance
    //the raw sMessage.msg string may be something like:
    //  "I am happy #~ue,2c9d2da6.gif,mhappy~#"
    //This returns that in the more human readable format:
    //  "I am happy :mhappy"
    get pMessage(): string {
        //Formats the parsed message component of this packet, if one exists, with decoded emotes
        if (this._pMessage === undefined && typeof this.sMessage === 'object') {
            if (this.FCType === FCTYPE.CMESG || this.FCType === FCTYPE.PMESG || this.FCType === FCTYPE.TOKENINC) {
                var obj: Message = <Message>(this.sMessage);
                if (obj && obj.msg) {
                    this._pMessage = this._parseEmotes(obj.msg);
                }
            }
        }
        return this._pMessage;
    }

    //For chat, PM, or tip messages, this property returns the text of the
    //message as it would appear in the MFC chat window with the username
    //prepended, etc:
    //
    //  AspenRae: Thanks guys! :mhappy
    //
    //This is useful for logging.
    get chatString(): string {
        if (this._chatString === undefined) {
            if (this.sMessage && typeof this.sMessage === 'object') {
                switch (this.FCType) {
                    case FCTYPE.CMESG:
                    case FCTYPE.PMESG:
                        var msg: Message = <Message>(this.sMessage);
                        this._chatString = msg.nm + ": " + this.pMessage;
                        break;
                    case FCTYPE.TOKENINC:
                        var tok: FCTokenIncResponse = <FCTokenIncResponse>(this.sMessage);
                        this._chatString = tok.u[2] + " has tipped " + tok.m[2] + " " + tok.tokens + " tokens" + (this.pMessage ? (": '" + this.pMessage + "'") : ".");
                        break;
                }
            }
        }

        return this._chatString;
    }

    toString(): string {
        function censor(key: string, value: any) {
            if (key === "client") {
                //Prevent a circular reference
                return undefined;
            }
            if (key === "FCType") {
                //Replace the numerical FCType value with it's more readable textual form
                return FCTYPE[this.FCType];
            }
            return value;
        }
        return JSON.stringify(this, censor);
    }
}

exports.Packet = Packet;
