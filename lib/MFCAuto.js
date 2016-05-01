var EventEmitter = require("events").EventEmitter;
var assert = require("assert");
var Client = (function () {
    function Client(username, password) {
        if (username === void 0) { username = "guest"; }
        if (password === void 0) { password = "guest"; }
        this.debug = false;
        this.net = require("net");
        this.username = username;
        this.password = password;
        this.sessionId = 0;
        this.streamBuffer = new Buffer(0);
        this.streamBufferPosition = 0;
        this.manualDisconnect = false;
    }
    Client.prototype.log = function (msg, debugOnly) {
        if (debugOnly === void 0) { debugOnly = false; }
        if (debugOnly && !this.debug) {
            return;
        }
        log(msg);
    };
    Client.prototype._readData = function (buf) {
        this.streamBuffer = Buffer.concat([this.streamBuffer, buf]);
        this._readPacket();
    };
    Client.prototype._packetReceived = function (packet) {
        this.log(packet.toString(), true);
        switch (packet.FCType) {
            case FCTYPE.LOGIN:
                if (packet.nArg1 !== 0) {
                    this.log("Login failed for user '" + this.username + "' password '" + this.password + "'");
                    throw new Error("Login failed");
                }
                else {
                    this.sessionId = packet.nTo;
                    this.uid = packet.nArg2;
                    this.username = packet.sMessage;
                    this.log("Login handshake completed. Logged in as '" + this.username + "' with sessionId " + this.sessionId);
                }
                break;
            case FCTYPE.DETAILS:
            case FCTYPE.ROOMHELPER:
            case FCTYPE.SESSIONSTATE:
            case FCTYPE.ADDFRIEND:
            case FCTYPE.ADDIGNORE:
            case FCTYPE.CMESG:
            case FCTYPE.PMESG:
            case FCTYPE.TXPROFILE:
            case FCTYPE.USERNAMELOOKUP:
            case FCTYPE.MYCAMSTATE:
            case FCTYPE.MYWEBCAM:
                if ((packet.FCType === FCTYPE.DETAILS && packet.nFrom === FCTYPE.TOKENINC) ||
                    (packet.FCType === FCTYPE.ROOMHELPER && packet.nArg2 < 100) ||
                    (packet.FCType === FCTYPE.JOINCHAN && packet.nArg2 === FCCHAN.PART)) {
                    break;
                }
                if (packet.sMessage !== undefined) {
                    var lv = packet.sMessage.lv;
                    var uid = packet.sMessage.uid;
                    if (uid === undefined) {
                        uid = packet.aboutModel.uid;
                    }
                    if (uid !== undefined && uid !== -1 && (lv === undefined || lv === 4)) {
                        var possibleModel = Model.getModel(uid, lv === 4);
                        if (possibleModel !== undefined) {
                            possibleModel.mergePacket(packet);
                        }
                    }
                }
                break;
            case FCTYPE.TAGS:
                var tagPayload = packet.sMessage;
                for (var key in tagPayload) {
                    if (tagPayload.hasOwnProperty(key)) {
                        Model.getModel(key).mergePacket(packet);
                    }
                }
                break;
            case FCTYPE.BOOKMARKS:
                break;
            default:
                break;
        }
        this.emit(FCTYPE[packet.FCType], packet);
        this.emit(FCTYPE[FCTYPE.ANY], packet);
    };
    Client.prototype._readPacket = function () {
        var pos = this.streamBufferPosition;
        var intParams = [];
        var strParam;
        try {
            for (var i = 0; i < 7; i++) {
                intParams.push(this.streamBuffer.readInt32BE(pos));
                pos += 4;
            }
            if (intParams[0] === MAGIC) {
                if (intParams[6] > 0) {
                    if (pos + intParams[6] > this.streamBuffer.length) {
                        throw new RangeError();
                    }
                    strParam = this.streamBuffer.toString("utf8", pos, pos + intParams[6]);
                    pos = pos + intParams[6];
                }
            }
            else {
                throw new Error("Invalid packet received! - " + intParams[0] + " Length == " + this.streamBuffer.length);
            }
            var strParam2 = void 0;
            if (strParam) {
                try {
                    strParam2 = JSON.parse(strParam);
                }
                catch (e) {
                    strParam2 = strParam;
                }
            }
            this._packetReceived(new Packet(intParams[1], intParams[2], intParams[3], intParams[4], intParams[5], intParams[6], strParam2));
            if (pos < this.streamBuffer.length) {
                this.streamBufferPosition = pos;
                this._readPacket();
            }
            else {
                this.streamBuffer = new Buffer(0);
                this.streamBufferPosition = 0;
            }
        }
        catch (e) {
            if (e.toString().indexOf("RangeError") !== 0) {
                throw e;
            }
            else {
            }
        }
    };
    Client.prototype.EncodeRawChat = function (rawMsg) {
        var _this = this;
        if (arguments.length !== 1) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise(function (resolve, reject) {
            if (rawMsg.match(/^\s*$/) || !rawMsg.match(/:/)) {
                resolve(rawMsg);
                return;
            }
            rawMsg = rawMsg.replace(/`/g, "'");
            rawMsg = rawMsg.replace(/<~/g, "'");
            rawMsg = rawMsg.replace(/~>/g, "'");
            _this.ensureEmoteParserIsLoaded().then(function () {
                _this.emoteParser.Process(rawMsg, resolve);
            });
        });
    };
    Client.prototype.loadFromMFC = function (url, massager) {
        if (arguments.length > 2) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise(function (resolve, reject) {
            var http = require("http");
            var load = require("load");
            http.get(url, function (res) {
                var contents = "";
                res.on("data", function (chunk) {
                    contents += chunk;
                });
                res.on("end", function () {
                    try {
                        if (massager !== undefined) {
                            contents = massager(contents);
                        }
                        var mfcModule = load.compiler(contents);
                        resolve(mfcModule);
                    }
                    catch (e) {
                        reject(e);
                    }
                });
            }).on("error", function (e) {
                reject(e);
            });
        });
    };
    Client.prototype.ensureEmoteParserIsLoaded = function () {
        var _this = this;
        if (arguments.length !== 0) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise(function (resolve, reject) {
            if (_this.emoteParser !== undefined) {
                resolve();
            }
            else {
                _this.loadFromMFC("http://www.myfreecams.com/_js/mfccore.js", function (content) {
                    var startIndex = content.indexOf("function ParseEmoteInput()");
                    var endIndex = content.indexOf("function ParseEmoteOutput()");
                    assert.ok(startIndex !== -1 && endIndex !== -1 && startIndex < endIndex, "mfccore.js layout has changed, don't know what to do now");
                    content = content.substr(startIndex, endIndex - startIndex);
                    content = "var document = {cookie: ''};var XMLHttpRequest = require('XMLHttpRequest').XMLHttpRequest;function bind(that,f){return f.bind(that);}" + content.replace(/createRequestObject\(\)/g, "new XMLHttpRequest()").replace(/new MfcImageHost\(\)/g, "{host: function(){return '';}}").replace(/this\.Reset\(\);/g, "this.Reset();this.oReq = new XMLHttpRequest();");
                    return content;
                }).then(function (obj) {
                    _this.emoteParser = new obj.ParseEmoteInput();
                    _this.emoteParser.setUrl("http://www.myfreecams.com/mfc2/php/ParseChatStream.php");
                    resolve();
                }).catch(function (reason) {
                    reject(reason);
                });
            }
        });
    };
    Client.prototype.ensureServerConfigIsLoaded = function () {
        var _this = this;
        if (arguments.length !== 0) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise(function (resolve, reject) {
            if (_this.serverConfig !== undefined) {
                resolve();
            }
            else {
                _this.loadFromMFC("http://www.myfreecams.com/_js/serverconfig.js", function (text) {
                    return "var serverConfig = " + text;
                }).then(function (obj) {
                    _this.serverConfig = obj.serverConfig;
                    resolve();
                });
            }
        });
    };
    Client.prototype.TxCmd = function (nType, nTo, nArg1, nArg2, sMsg) {
        if (nTo === void 0) { nTo = 0; }
        if (nArg1 === void 0) { nArg1 = 0; }
        if (nArg2 === void 0) { nArg2 = 0; }
        this.log("TxCmd Sending - nType: " + nType + ", nTo: " + nTo + ", nArg1: " + nArg1 + ", nArg2: " + nArg2 + ", sMsg:" + sMsg, true);
        if (sMsg && (nType === FCTYPE.CMESG || nType === FCTYPE.PMESG)) {
            if (sMsg.match(/([\u0000-\u001f\u0022-\u0026\u0080-\uffff]+)/)) {
                sMsg = escape(sMsg).replace(/%20/g, " ");
            }
        }
        var msgLength = (sMsg ? sMsg.length : 0);
        var buf = new Buffer((7 * 4) + msgLength);
        buf.writeInt32BE(MAGIC, 0);
        buf.writeInt32BE(nType, 4);
        buf.writeInt32BE(this.sessionId, 8);
        buf.writeInt32BE(nTo, 12);
        buf.writeInt32BE(nArg1, 16);
        buf.writeInt32BE(nArg2, 20);
        buf.writeInt32BE(msgLength, 24);
        if (sMsg) {
            buf.write(sMsg, 28);
        }
        this.client.write(buf);
    };
    Client.toUserId = function (id) {
        if (id > 100000000) {
            id = id - 100000000;
        }
        return id;
    };
    Client.toRoomId = function (id) {
        if (id < 100000000) {
            id = id + 100000000;
        }
        return id;
    };
    Client.prototype.sendChat = function (id, msg) {
        var _this = this;
        this.EncodeRawChat(msg).then(function (encodedMsg) {
            id = Client.toRoomId(id);
            _this.TxCmd(FCTYPE.CMESG, id, 0, 0, encodedMsg);
        });
    };
    Client.prototype.sendPM = function (id, msg) {
        var _this = this;
        this.EncodeRawChat(msg).then(function (encodedMsg) {
            id = Client.toUserId(id);
            _this.TxCmd(FCTYPE.PMESG, id, 0, 0, encodedMsg);
        });
    };
    Client.prototype.joinRoom = function (id) {
        id = Client.toRoomId(id);
        this.TxCmd(FCTYPE.JOINCHAN, 0, id, FCCHAN.JOIN);
    };
    Client.prototype.leaveRoom = function (id) {
        id = Client.toRoomId(id);
        this.TxCmd(FCTYPE.JOINCHAN, 0, id, FCCHAN.PART);
    };
    Client.prototype.queryUser = function (user) {
        var _this = this;
        Client.userQueryId = Client.userQueryId || 20;
        var queryId = Client.userQueryId++;
        return new Promise(function (resolve, reject) {
            var handler = function (p) {
                if (p.nArg1 === queryId) {
                    _this.removeListener("USERNAMELOOKUP", handler);
                    if (typeof p.sMessage === "string" || typeof p.sMessage === undefined) {
                        resolve(undefined);
                    }
                    else {
                        resolve(p.sMessage);
                    }
                }
            };
            _this.on("USERNAMELOOKUP", handler);
            switch (typeof user) {
                case "number":
                    _this.TxCmd(FCTYPE.USERNAMELOOKUP, 0, queryId, user);
                    break;
                case "string":
                    _this.TxCmd(FCTYPE.USERNAMELOOKUP, 0, queryId, 0, user);
                    break;
                default:
                    throw new Error("Invalid argument");
            }
        });
    };
    Client.prototype.connect = function (doLogin) {
        var _this = this;
        if (doLogin === void 0) { doLogin = true; }
        if (arguments.length > 1) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise(function (resolve, reject) {
            _this.streamBuffer = new Buffer(0);
            _this.streamBufferPosition = 0;
            _this.ensureServerConfigIsLoaded().then(function () {
                var chatServer = _this.serverConfig.chat_servers[Math.floor(Math.random() * _this.serverConfig.chat_servers.length)];
                _this.log("Connecting to MyFreeCams chat server " + chatServer + "...");
                _this.hookModelsLoaded();
                _this.client = _this.net.connect(8100, chatServer + ".myfreecams.com", function () {
                    _this.client.on("data", function (data) {
                        _this._readData(data);
                    });
                    _this.client.on("end", function () {
                        clearInterval(_this.keepAlive);
                        if (_this.password === "guest" && _this.username.startsWith("Guest")) {
                            _this.username = "guest";
                        }
                        if (!_this.manualDisconnect) {
                            _this.log("Disconnected from MyFreeCams.  Reconnecting in 30 seconds...");
                            setTimeout(_this.connect.bind(_this), 30000);
                        }
                        else {
                            _this.manualDisconnect = false;
                        }
                        _this.emit("CLIENT_DISCONNECTED");
                        Model.reset();
                    });
                    if (doLogin) {
                        _this.login();
                    }
                    _this.keepAlive = setInterval(function () { this.TxCmd(FCTYPE.NULL, 0, 0, 0); }.bind(_this), 120 * 1000);
                    _this.emit("CLIENT_CONNECTED");
                    resolve();
                });
            });
        });
    };
    Client.prototype.login = function (username, password) {
        if (username !== undefined) {
            this.username = username;
        }
        if (password !== undefined) {
            this.password = password;
        }
        this.TxCmd(FCTYPE.LOGIN, 0, 20071025, 0, this.username + ":" + this.password);
    };
    Client.prototype.hookModelsLoaded = function () {
        var completedModels = false;
        var completedFriends = true;
        function modelListFinished(packet) {
            if (packet.nTo === 2) {
                if (packet.nArg1 !== packet.nArg2) {
                    completedFriends = false;
                }
                else {
                    completedFriends = true;
                }
            }
            if (packet.nTo === 20 && packet.nArg1 === packet.nArg2) {
                completedModels = true;
            }
            if (completedModels && completedFriends) {
                this.removeListener("METRICS", modelListFinished);
                this.emit("CLIENT_MODELSLOADED");
            }
        }
        this.on("METRICS", modelListFinished.bind(this));
    };
    Client.prototype.connectAndWaitForModels = function () {
        var _this = this;
        if (arguments.length !== 0) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise(function (resolve, reject) {
            _this.once("CLIENT_MODELSLOADED", resolve);
            _this.connect(true);
        });
    };
    Client.prototype.disconnect = function () {
        if (this.client !== undefined) {
            this.manualDisconnect = true;
            this.client.end();
            this.client = undefined;
        }
    };
    return Client;
}());
applyMixins(Client, [EventEmitter]);
exports.Client = Client;
var MAGIC = -2027771214;
var STATE;
(function (STATE) {
    STATE[STATE["FreeChat"] = 0] = "FreeChat";
    STATE[STATE["Away"] = 2] = "Away";
    STATE[STATE["Private"] = 12] = "Private";
    STATE[STATE["GroupShow"] = 13] = "GroupShow";
    STATE[STATE["Online"] = 90] = "Online";
    STATE[STATE["Offline"] = 127] = "Offline";
})(STATE || (STATE = {}));
var DISPLAY;
(function (DISPLAY) {
    DISPLAY[DISPLAY["PM_INLINE_WHISPER"] = 1] = "PM_INLINE_WHISPER";
    DISPLAY[DISPLAY["PM_INLINE_ALL"] = 2] = "PM_INLINE_ALL";
})(DISPLAY || (DISPLAY = {}));
var EVSESSION;
(function (EVSESSION) {
    EVSESSION[EVSESSION["NONE"] = 0] = "NONE";
    EVSESSION[EVSESSION["PRIVATE"] = 1] = "PRIVATE";
    EVSESSION[EVSESSION["VOYEUR"] = 2] = "VOYEUR";
    EVSESSION[EVSESSION["GROUP"] = 3] = "GROUP";
    EVSESSION[EVSESSION["FEATURE"] = 4] = "FEATURE";
    EVSESSION[EVSESSION["AWAYPVT"] = 5] = "AWAYPVT";
    EVSESSION[EVSESSION["TIP"] = 10] = "TIP";
    EVSESSION[EVSESSION["PUBLIC"] = 100] = "PUBLIC";
    EVSESSION[EVSESSION["AWAY"] = 101] = "AWAY";
    EVSESSION[EVSESSION["START"] = 102] = "START";
    EVSESSION[EVSESSION["UPDATE"] = 103] = "UPDATE";
    EVSESSION[EVSESSION["STOP"] = 104] = "STOP";
})(EVSESSION || (EVSESSION = {}));
var FCACCEPT;
(function (FCACCEPT) {
    FCACCEPT[FCACCEPT["NOBODY"] = 0] = "NOBODY";
    FCACCEPT[FCACCEPT["FRIENDS"] = 1] = "FRIENDS";
    FCACCEPT[FCACCEPT["ALL"] = 2] = "ALL";
    FCACCEPT[FCACCEPT["V2_NONE"] = 8] = "V2_NONE";
    FCACCEPT[FCACCEPT["V2_FRIENDS"] = 16] = "V2_FRIENDS";
    FCACCEPT[FCACCEPT["V2_MODELS"] = 32] = "V2_MODELS";
    FCACCEPT[FCACCEPT["V2_PREMIUMS"] = 64] = "V2_PREMIUMS";
    FCACCEPT[FCACCEPT["V2_BASICS"] = 128] = "V2_BASICS";
    FCACCEPT[FCACCEPT["V2_ALL"] = 240] = "V2_ALL";
})(FCACCEPT || (FCACCEPT = {}));
var FCBAN;
(function (FCBAN) {
    FCBAN[FCBAN["NONE"] = 0] = "NONE";
    FCBAN[FCBAN["TEMP"] = 1] = "TEMP";
    FCBAN[FCBAN["60DAY"] = 2] = "60DAY";
    FCBAN[FCBAN["LIFE"] = 3] = "LIFE";
})(FCBAN || (FCBAN = {}));
var FCCHAN;
(function (FCCHAN) {
    FCCHAN[FCCHAN["NOOPT"] = 0] = "NOOPT";
    FCCHAN[FCCHAN["JOIN"] = 1] = "JOIN";
    FCCHAN[FCCHAN["ERR_NOCHANNEL"] = 2] = "ERR_NOCHANNEL";
    FCCHAN[FCCHAN["PART"] = 2] = "PART";
    FCCHAN[FCCHAN["ERR_NOTMEMBER"] = 3] = "ERR_NOTMEMBER";
    FCCHAN[FCCHAN["ERR_GUESTMUTE"] = 4] = "ERR_GUESTMUTE";
    FCCHAN[FCCHAN["OLDMSG"] = 4] = "OLDMSG";
    FCCHAN[FCCHAN["ERR_GROUPMUTE"] = 5] = "ERR_GROUPMUTE";
    FCCHAN[FCCHAN["ERR_NOTALLOWED"] = 6] = "ERR_NOTALLOWED";
    FCCHAN[FCCHAN["ERR_CONTENT"] = 7] = "ERR_CONTENT";
    FCCHAN[FCCHAN["HISTORY"] = 8] = "HISTORY";
    FCCHAN[FCCHAN["LIST"] = 16] = "LIST";
    FCCHAN[FCCHAN["CAMSTATE"] = 16] = "CAMSTATE";
    FCCHAN[FCCHAN["WELCOME"] = 32] = "WELCOME";
    FCCHAN[FCCHAN["BATCHPART"] = 64] = "BATCHPART";
    FCCHAN[FCCHAN["EXT_USERNAME"] = 128] = "EXT_USERNAME";
    FCCHAN[FCCHAN["EXT_USERDATA"] = 256] = "EXT_USERDATA";
})(FCCHAN || (FCCHAN = {}));
var FCERRTYPE;
(function (FCERRTYPE) {
    FCERRTYPE[FCERRTYPE["INVALIDUSER"] = 10] = "INVALIDUSER";
    FCERRTYPE[FCERRTYPE["NOACCESS"] = 11] = "NOACCESS";
    FCERRTYPE[FCERRTYPE["NOSPACE"] = 12] = "NOSPACE";
})(FCERRTYPE || (FCERRTYPE = {}));
var FCGROUP;
(function (FCGROUP) {
    FCGROUP[FCGROUP["NONE"] = 0] = "NONE";
    FCGROUP[FCGROUP["EXPIRED"] = 1] = "EXPIRED";
    FCGROUP[FCGROUP["BUSY"] = 2] = "BUSY";
    FCGROUP[FCGROUP["EMPTY"] = 3] = "EMPTY";
    FCGROUP[FCGROUP["DECLINED"] = 4] = "DECLINED";
    FCGROUP[FCGROUP["UNAVAILABLE"] = 5] = "UNAVAILABLE";
    FCGROUP[FCGROUP["SESSION"] = 9] = "SESSION";
})(FCGROUP || (FCGROUP = {}));
var FCLEVEL;
(function (FCLEVEL) {
    FCLEVEL[FCLEVEL["GUEST"] = 0] = "GUEST";
    FCLEVEL[FCLEVEL["BASIC"] = 1] = "BASIC";
    FCLEVEL[FCLEVEL["PREMIUM"] = 2] = "PREMIUM";
    FCLEVEL[FCLEVEL["MODEL"] = 4] = "MODEL";
    FCLEVEL[FCLEVEL["ADMIN"] = 5] = "ADMIN";
})(FCLEVEL || (FCLEVEL = {}));
var FCMODE;
(function (FCMODE) {
    FCMODE[FCMODE["NOPM"] = 0] = "NOPM";
    FCMODE[FCMODE["FRIENDPM"] = 1] = "FRIENDPM";
    FCMODE[FCMODE["ALLPM"] = 2] = "ALLPM";
})(FCMODE || (FCMODE = {}));
var FCMODEL;
(function (FCMODEL) {
    FCMODEL[FCMODEL["NONE"] = 0] = "NONE";
    FCMODEL[FCMODEL["NOGROUP"] = 1] = "NOGROUP";
    FCMODEL[FCMODEL["FEATURE1"] = 2] = "FEATURE1";
    FCMODEL[FCMODEL["FEATURE2"] = 4] = "FEATURE2";
    FCMODEL[FCMODEL["FEATURE3"] = 8] = "FEATURE3";
    FCMODEL[FCMODEL["FEATURE4"] = 16] = "FEATURE4";
    FCMODEL[FCMODEL["FEATURE5"] = 32] = "FEATURE5";
})(FCMODEL || (FCMODEL = {}));
var FCNEWSOPT;
(function (FCNEWSOPT) {
    FCNEWSOPT[FCNEWSOPT["NONE"] = 0] = "NONE";
    FCNEWSOPT[FCNEWSOPT["IN_CHAN"] = 1] = "IN_CHAN";
    FCNEWSOPT[FCNEWSOPT["IN_PM"] = 2] = "IN_PM";
    FCNEWSOPT[FCNEWSOPT["AUTOFRIENDS_OFF"] = 4] = "AUTOFRIENDS_OFF";
    FCNEWSOPT[FCNEWSOPT["ADDFRIENDS_OFF"] = 4] = "ADDFRIENDS_OFF";
    FCNEWSOPT[FCNEWSOPT["IN_CHAN_NOPVT"] = 8] = "IN_CHAN_NOPVT";
    FCNEWSOPT[FCNEWSOPT["IN_CHAN_NOGRP"] = 16] = "IN_CHAN_NOGRP";
})(FCNEWSOPT || (FCNEWSOPT = {}));
var FCNOSESS;
(function (FCNOSESS) {
    FCNOSESS[FCNOSESS["NONE"] = 0] = "NONE";
    FCNOSESS[FCNOSESS["PVT"] = 1] = "PVT";
    FCNOSESS[FCNOSESS["GRP"] = 2] = "GRP";
    FCNOSESS[FCNOSESS["TRUEPVT"] = 4] = "TRUEPVT";
    FCNOSESS[FCNOSESS["TOKEN_MIN"] = 8] = "TOKEN_MIN";
})(FCNOSESS || (FCNOSESS = {}));
var FCOPT;
(function (FCOPT) {
    FCOPT[FCOPT["NONE"] = 0] = "NONE";
    FCOPT[FCOPT["BOLD"] = 1] = "BOLD";
    FCOPT[FCOPT["ITALICS"] = 2] = "ITALICS";
    FCOPT[FCOPT["REMOTEPVT"] = 4] = "REMOTEPVT";
    FCOPT[FCOPT["TRUEPVT"] = 8] = "TRUEPVT";
    FCOPT[FCOPT["CAM2CAM"] = 16] = "CAM2CAM";
    FCOPT[FCOPT["RGNBLOCK"] = 32] = "RGNBLOCK";
    FCOPT[FCOPT["TOKENAPPROX"] = 64] = "TOKENAPPROX";
    FCOPT[FCOPT["TOKENHIDE"] = 128] = "TOKENHIDE";
    FCOPT[FCOPT["RPAPPROX"] = 256] = "RPAPPROX";
    FCOPT[FCOPT["RPHIDE"] = 512] = "RPHIDE";
    FCOPT[FCOPT["HDVIDEO"] = 1024] = "HDVIDEO";
    FCOPT[FCOPT["MODELSW"] = 2048] = "MODELSW";
    FCOPT[FCOPT["GUESTMUTE"] = 4096] = "GUESTMUTE";
    FCOPT[FCOPT["BASICMUTE"] = 8192] = "BASICMUTE";
    FCOPT[FCOPT["SMALLCAPS"] = 16384] = "SMALLCAPS";
    FCOPT[FCOPT["BOOKMARK"] = 16384] = "BOOKMARK";
})(FCOPT || (FCOPT = {}));
var FCRESPONSE;
(function (FCRESPONSE) {
    FCRESPONSE[FCRESPONSE["SUCCESS"] = 0] = "SUCCESS";
    FCRESPONSE[FCRESPONSE["ERROR"] = 1] = "ERROR";
    FCRESPONSE[FCRESPONSE["NOTICE"] = 2] = "NOTICE";
    FCRESPONSE[FCRESPONSE["SUSPEND"] = 3] = "SUSPEND";
    FCRESPONSE[FCRESPONSE["SHUTOFF"] = 4] = "SHUTOFF";
    FCRESPONSE[FCRESPONSE["WARNING"] = 5] = "WARNING";
    FCRESPONSE[FCRESPONSE["QUEUED"] = 6] = "QUEUED";
    FCRESPONSE[FCRESPONSE["NO_RESULTS"] = 7] = "NO_RESULTS";
    FCRESPONSE[FCRESPONSE["CACHED"] = 8] = "CACHED";
    FCRESPONSE[FCRESPONSE["JSON"] = 9] = "JSON";
    FCRESPONSE[FCRESPONSE["INVALIDUSER"] = 10] = "INVALIDUSER";
    FCRESPONSE[FCRESPONSE["NOACCESS"] = 11] = "NOACCESS";
    FCRESPONSE[FCRESPONSE["NOSPACE"] = 12] = "NOSPACE";
})(FCRESPONSE || (FCRESPONSE = {}));
var FCSERV;
(function (FCSERV) {
    FCSERV[FCSERV["NONE"] = 0] = "NONE";
    FCSERV[FCSERV["VIDEO_CAM2CAM"] = 1] = "VIDEO_CAM2CAM";
    FCSERV[FCSERV["VIDEO_MODEL"] = 2] = "VIDEO_MODEL";
    FCSERV[FCSERV["VIDEO_RESV2"] = 4] = "VIDEO_RESV2";
    FCSERV[FCSERV["VIDEO_RESV3"] = 8] = "VIDEO_RESV3";
    FCSERV[FCSERV["CHAT_MASTER"] = 16] = "CHAT_MASTER";
    FCSERV[FCSERV["CHAT_SLAVE"] = 32] = "CHAT_SLAVE";
    FCSERV[FCSERV["CHAT_RESV2"] = 64] = "CHAT_RESV2";
    FCSERV[FCSERV["CHAT_RESV3"] = 128] = "CHAT_RESV3";
    FCSERV[FCSERV["AUTH"] = 256] = "AUTH";
    FCSERV[FCSERV["AUTH_RESV1"] = 512] = "AUTH_RESV1";
    FCSERV[FCSERV["AUTH_RESV2"] = 1024] = "AUTH_RESV2";
    FCSERV[FCSERV["AUTH_RESV3"] = 2048] = "AUTH_RESV3";
    FCSERV[FCSERV["TRANS"] = 4096] = "TRANS";
    FCSERV[FCSERV["TRANS_RESV1"] = 8192] = "TRANS_RESV1";
    FCSERV[FCSERV["TRANS_RESV2"] = 16384] = "TRANS_RESV2";
    FCSERV[FCSERV["TRANS_RESV3"] = 32768] = "TRANS_RESV3";
})(FCSERV || (FCSERV = {}));
var FCTYPE;
(function (FCTYPE) {
    FCTYPE[FCTYPE["CLIENT_DISCONNECTED"] = -5] = "CLIENT_DISCONNECTED";
    FCTYPE[FCTYPE["CLIENT_MODELSLOADED"] = -4] = "CLIENT_MODELSLOADED";
    FCTYPE[FCTYPE["CLIENT_CONNECTED"] = -3] = "CLIENT_CONNECTED";
    FCTYPE[FCTYPE["ANY"] = -2] = "ANY";
    FCTYPE[FCTYPE["UNKNOWN"] = -1] = "UNKNOWN";
    FCTYPE[FCTYPE["NULL"] = 0] = "NULL";
    FCTYPE[FCTYPE["LOGIN"] = 1] = "LOGIN";
    FCTYPE[FCTYPE["ADDFRIEND"] = 2] = "ADDFRIEND";
    FCTYPE[FCTYPE["PMESG"] = 3] = "PMESG";
    FCTYPE[FCTYPE["STATUS"] = 4] = "STATUS";
    FCTYPE[FCTYPE["DETAILS"] = 5] = "DETAILS";
    FCTYPE[FCTYPE["TOKENINC"] = 6] = "TOKENINC";
    FCTYPE[FCTYPE["ADDIGNORE"] = 7] = "ADDIGNORE";
    FCTYPE[FCTYPE["PRIVACY"] = 8] = "PRIVACY";
    FCTYPE[FCTYPE["ADDFRIENDREQ"] = 9] = "ADDFRIENDREQ";
    FCTYPE[FCTYPE["USERNAMELOOKUP"] = 10] = "USERNAMELOOKUP";
    FCTYPE[FCTYPE["ZBAN"] = 11] = "ZBAN";
    FCTYPE[FCTYPE["BROADCASTPROFILE"] = 11] = "BROADCASTPROFILE";
    FCTYPE[FCTYPE["BROADCASTNEWS"] = 12] = "BROADCASTNEWS";
    FCTYPE[FCTYPE["ANNOUNCE"] = 13] = "ANNOUNCE";
    FCTYPE[FCTYPE["MANAGELIST"] = 14] = "MANAGELIST";
    FCTYPE[FCTYPE["MANAGELISTS"] = 14] = "MANAGELISTS";
    FCTYPE[FCTYPE["INBOX"] = 15] = "INBOX";
    FCTYPE[FCTYPE["GWCONNECT"] = 16] = "GWCONNECT";
    FCTYPE[FCTYPE["RELOADSETTINGS"] = 17] = "RELOADSETTINGS";
    FCTYPE[FCTYPE["HIDEUSERS"] = 18] = "HIDEUSERS";
    FCTYPE[FCTYPE["RULEVIOLATION"] = 19] = "RULEVIOLATION";
    FCTYPE[FCTYPE["SESSIONSTATE"] = 20] = "SESSIONSTATE";
    FCTYPE[FCTYPE["REQUESTPVT"] = 21] = "REQUESTPVT";
    FCTYPE[FCTYPE["ACCEPTPVT"] = 22] = "ACCEPTPVT";
    FCTYPE[FCTYPE["REJECTPVT"] = 23] = "REJECTPVT";
    FCTYPE[FCTYPE["ENDSESSION"] = 24] = "ENDSESSION";
    FCTYPE[FCTYPE["TXPROFILE"] = 25] = "TXPROFILE";
    FCTYPE[FCTYPE["STARTVOYEUR"] = 26] = "STARTVOYEUR";
    FCTYPE[FCTYPE["SERVERREFRESH"] = 27] = "SERVERREFRESH";
    FCTYPE[FCTYPE["SETTING"] = 28] = "SETTING";
    FCTYPE[FCTYPE["BWSTATS"] = 29] = "BWSTATS";
    FCTYPE[FCTYPE["SETGUESTNAME"] = 30] = "SETGUESTNAME";
    FCTYPE[FCTYPE["SETTEXTOPT"] = 31] = "SETTEXTOPT";
    FCTYPE[FCTYPE["SERVERCONFIG"] = 32] = "SERVERCONFIG";
    FCTYPE[FCTYPE["MODELGROUP"] = 33] = "MODELGROUP";
    FCTYPE[FCTYPE["REQUESTGRP"] = 34] = "REQUESTGRP";
    FCTYPE[FCTYPE["STATUSGRP"] = 35] = "STATUSGRP";
    FCTYPE[FCTYPE["GROUPCHAT"] = 36] = "GROUPCHAT";
    FCTYPE[FCTYPE["CLOSEGRP"] = 37] = "CLOSEGRP";
    FCTYPE[FCTYPE["UCR"] = 38] = "UCR";
    FCTYPE[FCTYPE["MYUCR"] = 39] = "MYUCR";
    FCTYPE[FCTYPE["SLAVECON"] = 40] = "SLAVECON";
    FCTYPE[FCTYPE["SLAVECMD"] = 41] = "SLAVECMD";
    FCTYPE[FCTYPE["SLAVEFRIEND"] = 42] = "SLAVEFRIEND";
    FCTYPE[FCTYPE["SLAVEVSHARE"] = 43] = "SLAVEVSHARE";
    FCTYPE[FCTYPE["ROOMDATA"] = 44] = "ROOMDATA";
    FCTYPE[FCTYPE["NEWSITEM"] = 45] = "NEWSITEM";
    FCTYPE[FCTYPE["GUESTCOUNT"] = 46] = "GUESTCOUNT";
    FCTYPE[FCTYPE["PRELOGINQ"] = 47] = "PRELOGINQ";
    FCTYPE[FCTYPE["MODELGROUPSZ"] = 48] = "MODELGROUPSZ";
    FCTYPE[FCTYPE["ROOMHELPER"] = 49] = "ROOMHELPER";
    FCTYPE[FCTYPE["CMESG"] = 50] = "CMESG";
    FCTYPE[FCTYPE["JOINCHAN"] = 51] = "JOINCHAN";
    FCTYPE[FCTYPE["CREATECHAN"] = 52] = "CREATECHAN";
    FCTYPE[FCTYPE["INVITECHAN"] = 53] = "INVITECHAN";
    FCTYPE[FCTYPE["KICKCHAN"] = 54] = "KICKCHAN";
    FCTYPE[FCTYPE["QUIETCHAN"] = 55] = "QUIETCHAN";
    FCTYPE[FCTYPE["BANCHAN"] = 56] = "BANCHAN";
    FCTYPE[FCTYPE["PREVIEWCHAN"] = 57] = "PREVIEWCHAN";
    FCTYPE[FCTYPE["SHUTDOWN"] = 58] = "SHUTDOWN";
    FCTYPE[FCTYPE["LISTBANS"] = 59] = "LISTBANS";
    FCTYPE[FCTYPE["UNBAN"] = 60] = "UNBAN";
    FCTYPE[FCTYPE["SETWELCOME"] = 61] = "SETWELCOME";
    FCTYPE[FCTYPE["PERMABAN"] = 62] = "PERMABAN";
    FCTYPE[FCTYPE["CHANOP"] = 62] = "CHANOP";
    FCTYPE[FCTYPE["LISTCHAN"] = 63] = "LISTCHAN";
    FCTYPE[FCTYPE["TAGS"] = 64] = "TAGS";
    FCTYPE[FCTYPE["SETPCODE"] = 65] = "SETPCODE";
    FCTYPE[FCTYPE["SETMINTIP"] = 66] = "SETMINTIP";
    FCTYPE[FCTYPE["UEOPT"] = 67] = "UEOPT";
    FCTYPE[FCTYPE["HDVIDEO"] = 68] = "HDVIDEO";
    FCTYPE[FCTYPE["METRICS"] = 69] = "METRICS";
    FCTYPE[FCTYPE["OFFERCAM"] = 70] = "OFFERCAM";
    FCTYPE[FCTYPE["REQUESTCAM"] = 71] = "REQUESTCAM";
    FCTYPE[FCTYPE["MYWEBCAM"] = 72] = "MYWEBCAM";
    FCTYPE[FCTYPE["MYCAMSTATE"] = 73] = "MYCAMSTATE";
    FCTYPE[FCTYPE["PMHISTORY"] = 74] = "PMHISTORY";
    FCTYPE[FCTYPE["CHATFLASH"] = 75] = "CHATFLASH";
    FCTYPE[FCTYPE["TRUEPVT"] = 76] = "TRUEPVT";
    FCTYPE[FCTYPE["BOOKMARKS"] = 77] = "BOOKMARKS";
    FCTYPE[FCTYPE["EVENT"] = 78] = "EVENT";
    FCTYPE[FCTYPE["STATEDUMP"] = 79] = "STATEDUMP";
    FCTYPE[FCTYPE["RECOMMEND"] = 80] = "RECOMMEND";
    FCTYPE[FCTYPE["EXTDATA"] = 81] = "EXTDATA";
    FCTYPE[FCTYPE["ZGWINVALID"] = 95] = "ZGWINVALID";
    FCTYPE[FCTYPE["CONNECTING"] = 96] = "CONNECTING";
    FCTYPE[FCTYPE["CONNECTED"] = 97] = "CONNECTED";
    FCTYPE[FCTYPE["DISCONNECTED"] = 98] = "DISCONNECTED";
    FCTYPE[FCTYPE["LOGOUT"] = 99] = "LOGOUT";
})(FCTYPE || (FCTYPE = {}));
var FCUCR;
(function (FCUCR) {
    FCUCR[FCUCR["VM_LOUNGE"] = 0] = "VM_LOUNGE";
    FCUCR[FCUCR["CREATOR"] = 0] = "CREATOR";
    FCUCR[FCUCR["FRIENDS"] = 1] = "FRIENDS";
    FCUCR[FCUCR["VM_MYWEBCAM"] = 1] = "VM_MYWEBCAM";
    FCUCR[FCUCR["MODELS"] = 2] = "MODELS";
    FCUCR[FCUCR["PREMIUMS"] = 4] = "PREMIUMS";
    FCUCR[FCUCR["BASICS"] = 8] = "BASICS";
    FCUCR[FCUCR["BASIC"] = 8] = "BASIC";
    FCUCR[FCUCR["ALL"] = 15] = "ALL";
})(FCUCR || (FCUCR = {}));
var FCUPDATE;
(function (FCUPDATE) {
    FCUPDATE[FCUPDATE["NONE"] = 0] = "NONE";
    FCUPDATE[FCUPDATE["MISSMFC"] = 1] = "MISSMFC";
    FCUPDATE[FCUPDATE["NEWTIP"] = 2] = "NEWTIP";
})(FCUPDATE || (FCUPDATE = {}));
var FCVIDEO;
(function (FCVIDEO) {
    FCVIDEO[FCVIDEO["TX_IDLE"] = 0] = "TX_IDLE";
    FCVIDEO[FCVIDEO["TX_RESET"] = 1] = "TX_RESET";
    FCVIDEO[FCVIDEO["TX_AWAY"] = 2] = "TX_AWAY";
    FCVIDEO[FCVIDEO["TX_CONFIRMING"] = 11] = "TX_CONFIRMING";
    FCVIDEO[FCVIDEO["TX_PVT"] = 12] = "TX_PVT";
    FCVIDEO[FCVIDEO["TX_GRP"] = 13] = "TX_GRP";
    FCVIDEO[FCVIDEO["TX_RESERVED"] = 14] = "TX_RESERVED";
    FCVIDEO[FCVIDEO["TX_KILLMODEL"] = 15] = "TX_KILLMODEL";
    FCVIDEO[FCVIDEO["C2C_ON"] = 20] = "C2C_ON";
    FCVIDEO[FCVIDEO["C2C_OFF"] = 21] = "C2C_OFF";
    FCVIDEO[FCVIDEO["RX_IDLE"] = 90] = "RX_IDLE";
    FCVIDEO[FCVIDEO["RX_PVT"] = 91] = "RX_PVT";
    FCVIDEO[FCVIDEO["RX_VOY"] = 92] = "RX_VOY";
    FCVIDEO[FCVIDEO["RX_GRP"] = 93] = "RX_GRP";
    FCVIDEO[FCVIDEO["NULL"] = 126] = "NULL";
    FCVIDEO[FCVIDEO["UNKNOWN"] = 127] = "UNKNOWN";
    FCVIDEO[FCVIDEO["OFFLINE"] = 127] = "OFFLINE";
})(FCVIDEO || (FCVIDEO = {}));
var FCWINDOW;
(function (FCWINDOW) {
    FCWINDOW[FCWINDOW["NO_USER_PM"] = 20] = "NO_USER_PM";
    FCWINDOW[FCWINDOW["OPTIONS_ADD_FRIEND"] = 31] = "OPTIONS_ADD_FRIEND";
    FCWINDOW[FCWINDOW["OPTIONS_ADD_IGNORE"] = 32] = "OPTIONS_ADD_IGNORE";
})(FCWINDOW || (FCWINDOW = {}));
var FCWOPT;
(function (FCWOPT) {
    FCWOPT[FCWOPT["NONE"] = 0] = "NONE";
    FCWOPT[FCWOPT["ADD"] = 1] = "ADD";
    FCWOPT[FCWOPT["REMOVE"] = 2] = "REMOVE";
    FCWOPT[FCWOPT["LIST"] = 4] = "LIST";
    FCWOPT[FCWOPT["NO_RECEIPT"] = 128] = "NO_RECEIPT";
    FCWOPT[FCWOPT["REDIS_JSON"] = 256] = "REDIS_JSON";
    FCWOPT[FCWOPT["USERID"] = 1024] = "USERID";
    FCWOPT[FCWOPT["USERDATA"] = 2048] = "USERDATA";
    FCWOPT[FCWOPT["USERNAME"] = 4096] = "USERNAME";
    FCWOPT[FCWOPT["C_USERNAME"] = 32768] = "C_USERNAME";
    FCWOPT[FCWOPT["C_MONTHSLOGIN"] = 65536] = "C_MONTHSLOGIN";
    FCWOPT[FCWOPT["C_LEVEL"] = 131072] = "C_LEVEL";
    FCWOPT[FCWOPT["C_VSTATE"] = 262144] = "C_VSTATE";
    FCWOPT[FCWOPT["C_CHATTEXT"] = 524288] = "C_CHATTEXT";
    FCWOPT[FCWOPT["C_PROFILE"] = 1048576] = "C_PROFILE";
    FCWOPT[FCWOPT["C_AVATAR"] = 2097152] = "C_AVATAR";
    FCWOPT[FCWOPT["C_RANK"] = 4194304] = "C_RANK";
    FCWOPT[FCWOPT["C_SDATE"] = 8388608] = "C_SDATE";
})(FCWOPT || (FCWOPT = {}));
var HIDE;
(function (HIDE) {
    HIDE[HIDE["MODEL_GROUPS_AWAY"] = 1] = "MODEL_GROUPS_AWAY";
    HIDE[HIDE["MODEL_GROUPS_PRIVATE"] = 2] = "MODEL_GROUPS_PRIVATE";
    HIDE[HIDE["MODEL_GROUPS_GROUP"] = 4] = "MODEL_GROUPS_GROUP";
    HIDE[HIDE["MODEL_GROUPS_PUBLIC"] = 8] = "MODEL_GROUPS_PUBLIC";
})(HIDE || (HIDE = {}));
var LOUNGE;
(function (LOUNGE) {
    LOUNGE[LOUNGE["MASK_AUTO_CLICK"] = 1] = "MASK_AUTO_CLICK";
    LOUNGE[LOUNGE["MASK_NO_CAMSNAPS"] = 2] = "MASK_NO_CAMSNAPS";
    LOUNGE[LOUNGE["MASK_LOUNGE_MODE"] = 4] = "MASK_LOUNGE_MODE";
})(LOUNGE || (LOUNGE = {}));
var MODEL;
(function (MODEL) {
    MODEL[MODEL["LIST_ICON_NEW_MODEL"] = 1] = "LIST_ICON_NEW_MODEL";
    MODEL[MODEL["LIST_ICON_RECOMMEND"] = 2] = "LIST_ICON_RECOMMEND";
    MODEL[MODEL["LIST_ICON_POPULAR"] = 4] = "LIST_ICON_POPULAR";
    MODEL[MODEL["LIST_ICON_RECENT"] = 8] = "LIST_ICON_RECENT";
    MODEL[MODEL["LIST_ICON_MISSMFC"] = 16] = "LIST_ICON_MISSMFC";
    MODEL[MODEL["LIST_ICON_TRENDING"] = 32] = "LIST_ICON_TRENDING";
})(MODEL || (MODEL = {}));
var MODELORDER;
(function (MODELORDER) {
    MODELORDER[MODELORDER["NONE"] = 0] = "NONE";
    MODELORDER[MODELORDER["PVT"] = 1] = "PVT";
    MODELORDER[MODELORDER["TRUEPVT"] = 2] = "TRUEPVT";
    MODELORDER[MODELORDER["GRP"] = 4] = "GRP";
})(MODELORDER || (MODELORDER = {}));
var MYFREECAMS;
(function (MYFREECAMS) {
    MYFREECAMS[MYFREECAMS["NEWS_USER_ID"] = 481462] = "NEWS_USER_ID";
})(MYFREECAMS || (MYFREECAMS = {}));
var MYWEBCAM;
(function (MYWEBCAM) {
    MYWEBCAM[MYWEBCAM["EVERYONE"] = 0] = "EVERYONE";
    MYWEBCAM[MYWEBCAM["ONLYUSERS"] = 1] = "ONLYUSERS";
    MYWEBCAM[MYWEBCAM["ONLYFRIENDS"] = 2] = "ONLYFRIENDS";
    MYWEBCAM[MYWEBCAM["ONLYMODELS"] = 3] = "ONLYMODELS";
    MYWEBCAM[MYWEBCAM["FRIENDSANDMODELS"] = 4] = "FRIENDSANDMODELS";
    MYWEBCAM[MYWEBCAM["WHITELIST"] = 5] = "WHITELIST";
})(MYWEBCAM || (MYWEBCAM = {}));
var TKOPT;
(function (TKOPT) {
    TKOPT[TKOPT["NONE"] = 0] = "NONE";
    TKOPT[TKOPT["START"] = 1] = "START";
    TKOPT[TKOPT["STOP"] = 2] = "STOP";
    TKOPT[TKOPT["OPEN"] = 4] = "OPEN";
    TKOPT[TKOPT["PVT"] = 8] = "PVT";
    TKOPT[TKOPT["VOY"] = 16] = "VOY";
    TKOPT[TKOPT["GRP"] = 32] = "GRP";
    TKOPT[TKOPT["TIP"] = 256] = "TIP";
    TKOPT[TKOPT["TIP_HIDDEN_AMT"] = 512] = "TIP_HIDDEN_AMT";
    TKOPT[TKOPT["TIP_OFFLINE"] = 1024] = "TIP_OFFLINE";
    TKOPT[TKOPT["TIP_MSG"] = 2048] = "TIP_MSG";
    TKOPT[TKOPT["TIP_ANON"] = 4096] = "TIP_ANON";
    TKOPT[TKOPT["TIP_PUBLIC"] = 8192] = "TIP_PUBLIC";
    TKOPT[TKOPT["TIP_FROMROOM"] = 16384] = "TIP_FROMROOM";
    TKOPT[TKOPT["TIP_PUBLICMSG"] = 32768] = "TIP_PUBLICMSG";
    TKOPT[TKOPT["TIP_HISTORY"] = 65536] = "TIP_HISTORY";
    TKOPT[TKOPT["HDVIDEO"] = 1048576] = "HDVIDEO";
})(TKOPT || (TKOPT = {}));
var USEREXT;
(function (USEREXT) {
    USEREXT[USEREXT["NUM"] = 0] = "NUM";
    USEREXT[USEREXT["STRING"] = 1] = "STRING";
    USEREXT[USEREXT["DATA"] = 2] = "DATA";
    USEREXT[USEREXT["STAMP"] = 3] = "STAMP";
})(USEREXT || (USEREXT = {}));
var WEBCAM;
(function (WEBCAM) {
    WEBCAM[WEBCAM["SECURITY_EVERYONE"] = 0] = "SECURITY_EVERYONE";
    WEBCAM[WEBCAM["SECURITY_FRIENDS"] = 2] = "SECURITY_FRIENDS";
    WEBCAM[WEBCAM["SECURITY_MODELS"] = 3] = "SECURITY_MODELS";
    WEBCAM[WEBCAM["SECURITY_MODELS_FRIENDS"] = 4] = "SECURITY_MODELS_FRIENDS";
    WEBCAM[WEBCAM["SECURITY_ALLOWED"] = 5] = "SECURITY_ALLOWED";
    WEBCAM[WEBCAM["SECURITY_FRIEND_ID"] = 100] = "SECURITY_FRIEND_ID";
})(WEBCAM || (WEBCAM = {}));
var WINDOW;
(function (WINDOW) {
    WINDOW[WINDOW["MODE_DEFAULT"] = 0] = "MODE_DEFAULT";
    WINDOW[WINDOW["MODE_DHTML"] = 1] = "MODE_DHTML";
    WINDOW[WINDOW["MODE_DESKTOP_DHTML"] = 1] = "MODE_DESKTOP_DHTML";
    WINDOW[WINDOW["MODE_MOBILE_DHTML"] = 2] = "MODE_MOBILE_DHTML";
    WINDOW[WINDOW["MODE_BROWSER"] = 2] = "MODE_BROWSER";
})(WINDOW || (WINDOW = {}));
exports.DISPLAY = DISPLAY;
exports.EVSESSION = EVSESSION;
exports.FCACCEPT = FCACCEPT;
exports.FCBAN = FCBAN;
exports.FCCHAN = FCCHAN;
exports.FCERRTYPE = FCERRTYPE;
exports.FCGROUP = FCGROUP;
exports.FCLEVEL = FCLEVEL;
exports.FCMODE = FCMODE;
exports.FCMODEL = FCMODEL;
exports.FCNEWSOPT = FCNEWSOPT;
exports.FCNOSESS = FCNOSESS;
exports.FCOPT = FCOPT;
exports.FCRESPONSE = FCRESPONSE;
exports.FCSERV = FCSERV;
exports.FCTYPE = FCTYPE;
exports.FCUCR = FCUCR;
exports.FCUPDATE = FCUPDATE;
exports.FCVIDEO = FCVIDEO;
exports.FCWINDOW = FCWINDOW;
exports.FCWOPT = FCWOPT;
exports.HIDE = HIDE;
exports.LOUNGE = LOUNGE;
exports.MODEL = MODEL;
exports.MODELORDER = MODELORDER;
exports.MYFREECAMS = MYFREECAMS;
exports.MYWEBCAM = MYWEBCAM;
exports.TKOPT = TKOPT;
exports.USEREXT = USEREXT;
exports.WEBCAM = WEBCAM;
exports.WINDOW = WINDOW;
exports.STATE = STATE;
var EventEmitter = require("events").EventEmitter;
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
                if (sessionObj.vs === STATE.Offline) {
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
                session = { sid: 0, uid: this.uid, vs: STATE.Offline };
            }
            return session;
        },
        enumerable: true,
        configurable: true
    });
    Model.prototype.mergePacket = function (packet) {
        var previousSession = this.bestSession;
        var currentSessionId;
        if (packet.FCType === FCTYPE.TAGS) {
            currentSessionId = previousSession.sid;
        }
        else {
            currentSessionId = packet.sMessage.sid || 0;
        }
        if (!this.knownSessions.has(currentSessionId)) {
            this.knownSessions.set(currentSessionId, { sid: currentSessionId, uid: this.uid, vs: STATE.Offline });
        }
        var currentSession = this.knownSessions.get(currentSessionId);
        var callbackStack = [];
        switch (packet.FCType) {
            case FCTYPE.TAGS:
                var tagPayload = packet.sMessage;
                assert.notStrictEqual(tagPayload[this.uid], undefined, "This FCTYPE.TAGS messages doesn't appear to be about this model(" + this.uid + "): " + JSON.stringify(tagPayload));
                callbackStack.push({ prop: "tags", oldstate: this.tags, newstate: (this.tags = this.tags.concat(tagPayload[this.uid])) });
                break;
            default:
                var payload = packet.sMessage;
                assert.notStrictEqual(payload, undefined);
                assert.ok(payload.lv === undefined || payload.lv === 4, "Merging a non-model? Non-models need some special casing that is not currently implemented.");
                assert.ok((payload.uid !== undefined && this.uid === payload.uid) || packet.aboutModel.uid === this.uid, "Merging a packet meant for a different model!: " + packet.toString());
                for (var key in payload) {
                    if (key === "u" || key === "m" || key === "s") {
                        for (var key2 in payload[key]) {
                            if (!payload[key].hasOwnProperty(key2)) {
                                continue;
                            }
                            callbackStack.push({ prop: key2, oldstate: previousSession[key2], newstate: payload[key][key2] });
                            currentSession[key2] = payload[key][key2];
                            if (key === "m" && key2 === "flags") {
                                currentSession.truepvt = payload[key][key2] & FCOPT.TRUEPVT ? 1 : 0;
                                currentSession.guests_muted = payload[key][key2] & FCOPT.GUESTMUTE ? 1 : 0;
                                currentSession.basics_muted = payload[key][key2] & FCOPT.BASICMUTE ? 1 : 0;
                                currentSession.model_sw = payload[key][key2] & FCOPT.MODELSW ? 1 : 0;
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
            if (that.knownSessions.get(sid).vs === undefined || that.knownSessions.get(sid).vs === FCVIDEO.OFFLINE) {
                that.knownSessions.delete(sid);
            }
        });
    };
    Model.prototype.reset = function () {
        var _this = this;
        this.knownSessions.forEach(function (details) {
            if (details.sid !== _this.bestSessionId && details.vs !== FCVIDEO.OFFLINE) {
                details.vs = FCVIDEO.OFFLINE;
            }
        });
        var blank = new Packet(FCTYPE.SESSIONSTATE, 0, 0, 0, 0, 0, { sid: this.bestSessionId, uid: this.uid, vs: FCVIDEO.OFFLINE });
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
        this.processWhens(undefined);
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
    Model.eventsForAllModels = new EventEmitter();
    Model.addListener = Model.eventsForAllModels.addListener;
    Model.on = Model.eventsForAllModels.on;
    Model.once = Model.eventsForAllModels.once;
    Model.removeListener = Model.eventsForAllModels.removeListener;
    Model.removeAllListeners = Model.eventsForAllModels.removeAllListeners;
    Model.getMaxListeners = Model.eventsForAllModels.getMaxListeners;
    Model.setMaxListeners = Model.eventsForAllModels.setMaxListeners;
    Model.listeners = Model.eventsForAllModels.listeners;
    Model.emit = Model.eventsForAllModels.emit;
    Model.listenerCount = Model.eventsForAllModels.listenerCount;
    Model.knownModels = new Map();
    Model.whenMap = new Map();
    return Model;
}());
;
applyMixins(Model, [EventEmitter]);
exports.Model = Model;
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
                    case FCTYPE.ADDFRIEND:
                    case FCTYPE.ADDIGNORE:
                    case FCTYPE.JOINCHAN:
                    case FCTYPE.STATUS:
                    case FCTYPE.CHATFLASH:
                    case FCTYPE.BROADCASTPROFILE:
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
                        var rdm = this.sMessage;
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
                        id = -1;
                        break;
                    default:
                }
                id = Client.toUserId(id);
                this._aboutModel = Model.getModel(id);
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
            log("Error parsing emotes from '" + msg + "': " + e);
            return undefined;
        }
    };
    Object.defineProperty(Packet.prototype, "pMessage", {
        get: function () {
            if (this._pMessage === undefined && typeof this.sMessage === "object") {
                if (this.FCType === FCTYPE.CMESG || this.FCType === FCTYPE.PMESG || this.FCType === FCTYPE.TOKENINC) {
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
                        case FCTYPE.CMESG:
                        case FCTYPE.PMESG:
                            var msg = this.sMessage;
                            this._chatString = msg.nm + ": " + this.pMessage;
                            break;
                        case FCTYPE.TOKENINC:
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
                return FCTYPE[this.FCType];
            }
            return value;
        }
        return JSON.stringify(this, censor);
    };
    return Packet;
}());
exports.Packet = Packet;
function log(msg, fileRoot, consoleFormatter) {
    "use strict";
    assert.notStrictEqual(msg, undefined, "Trying to print undefined.  This usually indicates a bug upstream from the log function.");
    function toStr(n) { return n < 10 ? "0" + n : "" + n; }
    var fs = require("fs");
    var d = new Date();
    var taggedMsg = "[" + (toStr(d.getMonth() + 1)) + "/" + (toStr(d.getDate())) + "/" + (d.getFullYear()) + " - " + (toStr(d.getHours())) + ":" + (toStr(d.getMinutes())) + ":" + (toStr(d.getSeconds()));
    if (fileRoot !== undefined) {
        taggedMsg += (", " + fileRoot.toUpperCase() + "] " + msg);
    }
    else {
        taggedMsg += ("] " + msg);
    }
    if (consoleFormatter !== null) {
        if (consoleFormatter) {
            console.log(consoleFormatter(taggedMsg));
        }
        else {
            console.log(taggedMsg);
        }
    }
    if (fileRoot !== undefined) {
        var fd = fs.openSync(fileRoot + ".txt", "a");
        fs.writeSync(fd, taggedMsg + "\r\n");
        fs.closeSync(fd);
    }
}
function applyMixins(derivedCtor, baseCtors) {
    "use strict";
    baseCtors.forEach(function (baseCtor) {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach(function (name) {
            derivedCtor.prototype[name] = baseCtor.prototype[name];
        });
    });
}
exports.log = log;
exports.applyMixins = applyMixins;
//# sourceMappingURL=MFCAuto.js.map