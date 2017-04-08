"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var Client_1 = require("./Client");
var Constants_1 = require("./Constants");
var Utils_1 = require("./Utils");
var Model_1 = require("./Model");
var Packet = (function () {
    function Packet(FCType, nFrom, nTo, nArg1, nArg2, sPayload, sMessage) {
        this.FCType = FCType;
        this.nFrom = nFrom;
        this.nTo = nTo;
        this.nArg1 = nArg1;
        this.nArg2 = nArg2;
        this.sPayload = sPayload;
        this.sMessage = sMessage;
    }
    Object.defineProperty(Packet.prototype, "aboutModel", {
        get: function () {
            if (this._aboutModel === undefined) {
                var id = -1;
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
                        id = this.nTo;
                        break;
                    case Constants_1.FCTYPE.ROOMDATA:
                        var rdm = this.sMessage;
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
        },
        enumerable: true,
        configurable: true
    });
    Packet.prototype._parseEmotes = function (msg) {
        try {
            msg = unescape(msg);
            var nParseLimit = 0;
            var oImgRegExPattern = /#~(e|c|u|ue),(\w+)(\.?)(jpeg|jpg|gif|png)?,([\w\-\:\);\(\]\=\$\?\*]{0,48}),?(\d*),?(\d*)~#/;
            var re = [];
            while ((re = msg.match(oImgRegExPattern)) && nParseLimit < 10) {
                var sShortcut = re[5] || "";
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
    };
    Object.defineProperty(Packet.prototype, "pMessage", {
        get: function () {
            if (this._pMessage === undefined && typeof this.sMessage === "object") {
                if (this.FCType === Constants_1.FCTYPE.CMESG || this.FCType === Constants_1.FCTYPE.PMESG || this.FCType === Constants_1.FCTYPE.TOKENINC) {
                    var obj = this.sMessage;
                    if (obj && obj.msg) {
                        this._pMessage = this._parseEmotes(obj.msg);
                    }
                }
            }
            return this._pMessage;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(Packet.prototype, "chatString", {
        get: function () {
            if (this._chatString === undefined) {
                if (this.sMessage && typeof this.sMessage === "object") {
                    switch (this.FCType) {
                        case Constants_1.FCTYPE.CMESG:
                        case Constants_1.FCTYPE.PMESG:
                            var msg = this.sMessage;
                            this._chatString = msg.nm + ": " + this.pMessage;
                            break;
                        case Constants_1.FCTYPE.TOKENINC:
                            var tok = this.sMessage;
                            this._chatString = tok.u[2] + " has tipped " + tok.m[2] + " " + tok.tokens + " tokens" + (this.pMessage ? (": '" + this.pMessage + "'") : ".");
                            break;
                        default:
                            break;
                    }
                }
            }
            return this._chatString;
        },
        enumerable: true,
        configurable: true
    });
    Packet.prototype.toString = function () {
        function censor(key, value) {
            if (key === "FCType") {
                return Constants_1.FCTYPE[this.FCType];
            }
            return value;
        }
        return JSON.stringify(this, censor);
    };
    return Packet;
}());
exports.Packet = Packet;
//# sourceMappingURL=Packet.js.map