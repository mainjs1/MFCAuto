"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Client_1 = require("./Client");
const Constants_1 = require("./Constants");
const Utils_1 = require("./Utils");
const Model_1 = require("./Model");
class Packet {
    constructor(FCType, nFrom, nTo, nArg1, nArg2, sPayload, sMessage) {
        this.FCType = FCType;
        this.nFrom = nFrom;
        this.nTo = nTo;
        this.nArg1 = nArg1;
        this.nArg2 = nArg2;
        this.sPayload = sPayload;
        this.sMessage = sMessage;
    }
    get aboutModel() {
        if (this._aboutModel === undefined) {
            let id = -1;
            switch (this.FCType) {
                case Constants_1.FCTYPE.ADDFRIEND:
                case Constants_1.FCTYPE.ADDIGNORE:
                case Constants_1.FCTYPE.JOINCHAN:
                case Constants_1.FCTYPE.STATUS:
                case Constants_1.FCTYPE.CHATFLASH:
                case Constants_1.FCTYPE.ZBAN:
                    id = this.nArg1;
                    break;
                case Constants_1.FCTYPE.SESSIONSTATE:
                case Constants_1.FCTYPE.LISTCHAN:
                    id = this.nArg2;
                    break;
                case Constants_1.FCTYPE.USERNAMELOOKUP:
                case Constants_1.FCTYPE.NEWSITEM:
                case Constants_1.FCTYPE.PMESG:
                    id = this.nFrom;
                    break;
                case Constants_1.FCTYPE.GUESTCOUNT:
                case Constants_1.FCTYPE.TOKENINC:
                case Constants_1.FCTYPE.CMESG:
                case Constants_1.FCTYPE.BANCHAN:
                    id = this.nTo;
                    break;
                case Constants_1.FCTYPE.ROOMDATA:
                    let rdm = this.sMessage;
                    if (rdm !== undefined && rdm.model !== undefined) {
                        id = rdm.model;
                    }
                    break;
                case Constants_1.FCTYPE.LOGIN:
                case Constants_1.FCTYPE.MODELGROUP:
                case Constants_1.FCTYPE.PRIVACY:
                case Constants_1.FCTYPE.DETAILS:
                case Constants_1.FCTYPE.METRICS:
                case Constants_1.FCTYPE.UEOPT:
                case Constants_1.FCTYPE.SLAVEVSHARE:
                case Constants_1.FCTYPE.INBOX:
                case Constants_1.FCTYPE.EXTDATA:
                case Constants_1.FCTYPE.MYWEBCAM:
                case Constants_1.FCTYPE.TAGS:
                case Constants_1.FCTYPE.NULL:
                    id = -1;
                    break;
                default:
            }
            id = Client_1.Client.toUserId(id);
            this._aboutModel = Model_1.Model.getModel(id);
        }
        return this._aboutModel;
    }
    _parseEmotes(msg) {
        try {
            msg = unescape(msg);
            let nParseLimit = 0;
            let oImgRegExPattern = /#~(e|c|u|ue),(\w+)(\.?)(jpeg|jpg|gif|png)?,([\w\-\:\);\(\]\=\$\?\*]{0,48}),?(\d*),?(\d*)~#/;
            let re = [];
            while ((re = msg.match(oImgRegExPattern)) && nParseLimit < 10) {
                let sShortcut = re[5] || "";
                if (sShortcut) {
                    sShortcut = ":" + sShortcut;
                }
                else {
                    sShortcut = "<UNKNOWN EMOTE CODE: " + msg + ">";
                }
                msg = msg.replace(oImgRegExPattern, sShortcut);
                nParseLimit++;
            }
            return msg;
        }
        catch (e) {
            Utils_1.logWithLevel(Utils_1.LogLevel.WARNING, "Error parsing emotes from '" + msg + "': " + e);
            return undefined;
        }
    }
    get pMessage() {
        if (this._pMessage === undefined && typeof this.sMessage === "object") {
            if (this.FCType === Constants_1.FCTYPE.CMESG || this.FCType === Constants_1.FCTYPE.PMESG || this.FCType === Constants_1.FCTYPE.TOKENINC) {
                let obj = this.sMessage;
                if (obj && obj.msg) {
                    obj.msg = Utils_1.decodeIfNeeded(obj.msg);
                    this._pMessage = this._parseEmotes(obj.msg);
                }
            }
        }
        return this._pMessage;
    }
    get chatString() {
        if (this._chatString === undefined) {
            if (this.sMessage && typeof this.sMessage === "object") {
                switch (this.FCType) {
                    case Constants_1.FCTYPE.CMESG:
                    case Constants_1.FCTYPE.PMESG:
                        let msg = this.sMessage;
                        this._chatString = msg.nm + ": " + this.pMessage;
                        break;
                    case Constants_1.FCTYPE.TOKENINC:
                        let tok = this.sMessage;
                        this._chatString = tok.u[2] + " has tipped " + tok.m[2] + " " + tok.tokens + " tokens" + (this.pMessage ? (": '" + this.pMessage + "'") : ".");
                        break;
                    default:
                        break;
                }
            }
        }
        return this._chatString;
    }
    toString() {
        function censor(key, value) {
            if (key === "FCType") {
                return Constants_1.FCTYPE[this.FCType];
            }
            return value;
        }
        return JSON.stringify(this, censor);
    }
}
exports.Packet = Packet;
//# sourceMappingURL=Packet.js.map