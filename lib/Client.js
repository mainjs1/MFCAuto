"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var events_1 = require("events");
var Utils_1 = require("./Utils");
var Constants_1 = require("./Constants");
var Model_1 = require("./Model");
var Packet_1 = require("./Packet");
var http = require("http");
var assert = require("assert");
var Client = (function () {
    function Client(username, password) {
        if (username === void 0) { username = "guest"; }
        if (password === void 0) { password = "guest"; }
        this.choseToLogIn = false;
        this.completedFriends = true;
        this.completedModels = false;
        this.net = require("net");
        this.username = username;
        this.password = password;
        this.sessionId = 0;
        this.streamBuffer = new Buffer(0);
        this.streamBufferPosition = 0;
        this.manualDisconnect = false;
        this.loginPacketReceived = false;
        this.currentlyConnected = false;
    }
    Client.prototype._readData = function (buf) {
        this.streamBuffer = Buffer.concat([this.streamBuffer, buf]);
        this._readPacket();
    };
    Client.prototype._packetReceived = function (packet) {
        var _this = this;
        Utils_1.logWithLevel(Utils_1.LogLevel.TRACE, packet.toString());
        this.trafficCounter++;
        switch (packet.FCType) {
            case Constants_1.FCTYPE.LOGIN:
                if (packet.nArg1 !== 0) {
                    Utils_1.logWithLevel(Utils_1.LogLevel.ERROR, "Login failed for user '" + this.username + "' password '" + this.password + "'");
                    throw new Error("Login failed");
                }
                else {
                    this.sessionId = packet.nTo;
                    this.uid = packet.nArg2;
                    this.username = packet.sMessage;
                    Utils_1.logWithLevel(Utils_1.LogLevel.INFO, "Login handshake completed. Logged in as '" + this.username + "' with sessionId " + this.sessionId);
                    this.loginPacketReceived = true;
                    Client.currentReconnectSeconds = Client.initialReconnectSeconds;
                }
                break;
            case Constants_1.FCTYPE.DETAILS:
            case Constants_1.FCTYPE.ROOMHELPER:
            case Constants_1.FCTYPE.SESSIONSTATE:
            case Constants_1.FCTYPE.ADDFRIEND:
            case Constants_1.FCTYPE.ADDIGNORE:
            case Constants_1.FCTYPE.CMESG:
            case Constants_1.FCTYPE.PMESG:
            case Constants_1.FCTYPE.TXPROFILE:
            case Constants_1.FCTYPE.USERNAMELOOKUP:
            case Constants_1.FCTYPE.MYCAMSTATE:
            case Constants_1.FCTYPE.MYWEBCAM:
            case Constants_1.FCTYPE.JOINCHAN:
                if ((packet.FCType === Constants_1.FCTYPE.DETAILS && packet.nFrom === Constants_1.FCTYPE.TOKENINC) ||
                    (packet.FCType === Constants_1.FCTYPE.ROOMHELPER && packet.nArg2 < 100) ||
                    (packet.FCType === Constants_1.FCTYPE.JOINCHAN && packet.nArg2 === Constants_1.FCCHAN.PART)) {
                    break;
                }
                if (packet.sMessage !== undefined) {
                    var lv = packet.sMessage.lv;
                    var uid = packet.sMessage.uid;
                    if (uid === undefined && packet.aboutModel) {
                        uid = packet.aboutModel.uid;
                    }
                    if (uid !== undefined && uid !== -1 && (lv === undefined || lv === 4)) {
                        var possibleModel = Model_1.Model.getModel(uid, lv === 4);
                        if (possibleModel !== undefined) {
                            possibleModel.mergePacket(packet);
                        }
                    }
                }
                break;
            case Constants_1.FCTYPE.TAGS:
                var tagPayload = packet.sMessage;
                for (var key in tagPayload) {
                    if (tagPayload.hasOwnProperty(key)) {
                        var possibleModel = Model_1.Model.getModel(key);
                        if (possibleModel !== undefined) {
                            possibleModel.mergePacket(packet);
                        }
                    }
                }
                break;
            case Constants_1.FCTYPE.BOOKMARKS:
                break;
            case Constants_1.FCTYPE.EXTDATA:
                if (packet.nTo === this.sessionId && packet.nArg2 === Constants_1.FCWOPT.REDIS_JSON) {
                    this._handleExtData(packet.sMessage);
                }
                break;
            case Constants_1.FCTYPE.METRICS:
                if (!(this.completedFriends && this.completedModels)) {
                    switch (packet.nTo) {
                        case Constants_1.FCTYPE.ADDFRIEND:
                            if (packet.nArg1 !== packet.nArg2) {
                                this.completedFriends = false;
                            }
                            break;
                        case Constants_1.FCTYPE.SESSIONSTATE:
                            if (packet.nArg1 === packet.nArg2) {
                                this.completedModels = true;
                            }
                            if (this.completedFriends && this.completedModels) {
                                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] emitting: CLIENT_MODELSLOADED");
                                this.emit("CLIENT_MODELSLOADED");
                            }
                            break;
                        default:
                            break;
                    }
                }
                break;
            case Constants_1.FCTYPE.MANAGELIST:
                if (packet.nArg2 > 0 && packet.sMessage && packet.sMessage.rdata) {
                    var rdata = this._processListData(packet.sMessage.rdata);
                    var nType = packet.nArg2;
                    switch (nType) {
                        case Constants_1.FCL.ROOMMATES:
                            if (Array.isArray(rdata)) {
                                this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.METRICS, packet.nFrom, Constants_1.FCTYPE.JOINCHAN, 0, rdata.length, 0, undefined));
                                rdata.forEach(function (viewer) {
                                    _this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.JOINCHAN, packet.nFrom, packet.nTo, packet.sMessage.channel, Constants_1.FCCHAN.JOIN, 0, viewer));
                                });
                                this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.METRICS, packet.nFrom, Constants_1.FCTYPE.JOINCHAN, rdata.length, rdata.length, 0, undefined));
                            }
                            break;
                        case Constants_1.FCL.CAMS:
                            if (Array.isArray(rdata)) {
                                this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.METRICS, packet.nFrom, Constants_1.FCTYPE.SESSIONSTATE, 0, rdata.length, 0, undefined));
                                rdata.forEach(function (model) {
                                    _this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.SESSIONSTATE, packet.nFrom, packet.nTo, packet.nArg1, model.uid, 0, model));
                                });
                                this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.METRICS, packet.nFrom, Constants_1.FCTYPE.SESSIONSTATE, rdata.length, rdata.length, 0, undefined));
                            }
                            break;
                        case Constants_1.FCL.FRIENDS:
                            if (Array.isArray(rdata)) {
                                this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.METRICS, packet.nFrom, Constants_1.FCTYPE.ADDFRIEND, 0, rdata.length, 0, undefined));
                                rdata.forEach(function (model) {
                                    _this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.ADDFRIEND, packet.nFrom, packet.nTo, model.uid, packet.nArg2, 0, model));
                                });
                                this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.METRICS, packet.nFrom, Constants_1.FCTYPE.ADDFRIEND, rdata.length, rdata.length, 0, undefined));
                            }
                            break;
                        case Constants_1.FCL.IGNORES:
                            if (Array.isArray(rdata)) {
                                this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.METRICS, packet.nFrom, Constants_1.FCTYPE.ADDIGNORE, 0, rdata.length, 0, undefined));
                                rdata.forEach(function (user) {
                                    _this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.ADDIGNORE, packet.nFrom, packet.nTo, user.uid, packet.nArg2, 0, user));
                                });
                                this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.METRICS, packet.nFrom, Constants_1.FCTYPE.ADDIGNORE, rdata.length, rdata.length, 0, undefined));
                            }
                            break;
                        case Constants_1.FCL.TAGS:
                            if (typeof rdata === "object") {
                                this._packetReceived(new Packet_1.Packet(Constants_1.FCTYPE.TAGS, packet.nFrom, packet.nTo, packet.nArg1, packet.nArg2, packet.sPayload, rdata));
                            }
                            break;
                        default:
                            Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _packetReceived unhandled list type on MANAGELIST packet: " + nType);
                    }
                }
                break;
            default:
                break;
        }
        this.emit(Constants_1.FCTYPE[packet.FCType], packet);
        this.emit(Constants_1.FCTYPE[Constants_1.FCTYPE.ANY], packet);
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
            if (intParams[0] === Constants_1.MAGIC) {
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
            this._packetReceived(new Packet_1.Packet(intParams[1], intParams[2], intParams[3], intParams[4], intParams[5], intParams[6], strParam2));
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
    Client.prototype._handleExtData = function (extData) {
        var _this = this;
        if (extData && extData.respkey) {
            var url_1 = "http://www.myfreecams.com/php/FcwExtResp.php?";
            ["respkey", "type", "opts", "serv"].forEach(function (name) {
                url_1 += name + "=" + extData[name] + "&";
            });
            Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _handleExtData: " + JSON.stringify(extData) + " - '" + url_1 + "'");
            http.get(url_1, function (res) {
                var contents = "";
                res.on("data", function (chunk) {
                    contents += chunk;
                });
                res.on("end", function () {
                    try {
                        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _handleExtData response: " + JSON.stringify(extData) + " - '" + url_1 + "'\n\t" + contents.slice(0, 80) + "...");
                        var p = new Packet_1.Packet(extData.msg.type, extData.msg.from, extData.msg.to, extData.msg.arg1, extData.msg.arg2, extData.msglen, JSON.parse(contents));
                        _this._packetReceived(p);
                    }
                    catch (e) {
                        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _handleExtData invalid JSON: " + JSON.stringify(extData) + " - '" + url_1 + "'\n\t" + contents.slice(0, 80) + "...");
                    }
                });
            }).on("error", function (e) {
                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _handleExtData error: " + e + " - " + JSON.stringify(extData) + " - '" + url_1 + "'");
            });
        }
    };
    Client.prototype._processListData = function (rdata) {
        if (Array.isArray(rdata) && rdata.length > 0) {
            var result_1 = [];
            var schema_1 = rdata.shift();
            var schemaMap_1 = new Map();
            var schemaMapIndex_1 = 0;
            Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _processListData, processing schema: " + JSON.stringify(schema_1));
            if (schema_1 !== undefined && rdata.length > 0) {
                schema_1.forEach(function (prop) {
                    if (typeof prop === "object") {
                        Object.keys(prop).forEach(function (key) {
                            if (Array.isArray(prop[key])) {
                                prop[key].forEach(function (prop2) {
                                    schemaMap_1.set(schemaMapIndex_1++, [key, prop2]);
                                });
                            }
                            else {
                                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _processListData. N-level deep schemas? " + JSON.stringify(schema_1));
                            }
                        });
                    }
                    else {
                        schemaMap_1.set(schemaMapIndex_1++, [prop]);
                    }
                });
                rdata.forEach(function (record) {
                    if (Array.isArray(record)) {
                        var msg = {};
                        for (var i = 0; i < record.length; i++) {
                            if (schemaMap_1.has(i)) {
                                var path = schemaMap_1.get(i);
                                if (path.length === 1) {
                                    msg[path[0]] = record[i];
                                }
                                else if (path.length === 2) {
                                    if (msg[path[0]] === undefined) {
                                        msg[path[0]] = {};
                                    }
                                    msg[path[0]][path[1]] = record[i];
                                }
                                else {
                                    Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _processListData. N-level deep schemas? " + JSON.stringify(schema_1));
                                }
                            }
                            else {
                                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _processListData. Not enough elements in schema\n\tSchema: " + JSON.stringify(schema_1) + "\n\tData: " + JSON.stringify(record));
                            }
                        }
                        result_1.push(msg);
                    }
                    else {
                        result_1.push(record);
                    }
                });
            }
            else {
                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] _processListData. Malformed list data? " + JSON.stringify(schema_1) + " - " + JSON.stringify(rdata));
            }
            return result_1;
        }
        else {
            return rdata;
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
                    var startIndex = content.indexOf("// js_build_core: MfcJs/ParseEmoteInput/ParseEmoteInput.js");
                    var endIndex = content.indexOf("// js_build_core: ", startIndex + 1);
                    assert.ok(startIndex !== -1 && endIndex !== -1 && startIndex < endIndex, "mfccore.js layout has changed, don't know what to do now");
                    content = content.substr(startIndex, endIndex - startIndex);
                    content = "var document = {cookie: '', domain: 'myfreecams.com', location: { protocol: 'http:' }};var XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;function bind(that,f){return f.bind(that);}" + content;
                    content = content.replace(/this.createRequestObject\(\)/g, "new XMLHttpRequest()");
                    content = content.replace(/new MfcImageHost\(\)/g, "{host: function(){return '';}}");
                    content = content.replace(/this\.Reset\(\);/g, "this.Reset();this.oReq = new XMLHttpRequest();");
                    content = content.replace(/MfcClientRes/g, "undefined");
                    return content;
                }).then(function (obj) {
                    _this.emoteParser = new obj.ParseEmoteInput();
                    _this.emoteParser.setUrl("http://api.myfreecams.com/parseEmote");
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
                _this.loadFromMFC("http://www.myfreecams.com/_js/serverconfig.js?nc=" + Math.random(), function (text) {
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
        Utils_1.logWithLevel(Utils_1.LogLevel.VERBOSE, "TxCmd Sending - nType: " + nType + ", nTo: " + nTo + ", nArg1: " + nArg1 + ", nArg2: " + nArg2 + ", sMsg:" + sMsg);
        if (sMsg && (nType === Constants_1.FCTYPE.CMESG || nType === Constants_1.FCTYPE.PMESG)) {
            if (sMsg.match(/([\u0000-\u001f\u0022-\u0026\u0080-\uffff]+)/)) {
                sMsg = escape(sMsg).replace(/%20/g, " ");
            }
        }
        var msgLength = (sMsg ? sMsg.length : 0);
        var buf = new Buffer((7 * 4) + msgLength);
        buf.writeInt32BE(Constants_1.MAGIC, 0);
        buf.writeInt32BE(nType, 4);
        buf.writeInt32BE(this.sessionId, 8);
        buf.writeInt32BE(nTo, 12);
        buf.writeInt32BE(nArg1, 16);
        buf.writeInt32BE(nArg2, 20);
        buf.writeInt32BE(msgLength, 24);
        if (sMsg) {
            buf.write(sMsg, 28);
        }
        if (this.client !== undefined) {
            this.client.write(buf);
        }
        else {
            throw new Error("Cannot call TxCmd on a disconnected client");
        }
    };
    Client.prototype.TxPacket = function (packet) {
        this.TxCmd(packet.FCType, packet.nTo, packet.nArg1, packet.nArg2, JSON.stringify(packet.sMessage));
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
            _this.TxCmd(Constants_1.FCTYPE.CMESG, id, 0, 0, encodedMsg);
        });
    };
    Client.prototype.sendPM = function (id, msg) {
        var _this = this;
        this.EncodeRawChat(msg).then(function (encodedMsg) {
            id = Client.toUserId(id);
            _this.TxCmd(Constants_1.FCTYPE.PMESG, id, 0, 0, encodedMsg);
        });
    };
    Client.prototype.joinRoom = function (id) {
        id = Client.toRoomId(id);
        this.TxCmd(Constants_1.FCTYPE.JOINCHAN, 0, id, Constants_1.FCCHAN.JOIN);
    };
    Client.prototype.leaveRoom = function (id) {
        id = Client.toRoomId(id);
        this.TxCmd(Constants_1.FCTYPE.JOINCHAN, 0, id, Constants_1.FCCHAN.PART);
    };
    Client.prototype.queryUser = function (user) {
        var _this = this;
        Client.userQueryId = Client.userQueryId || 20;
        var queryId = Client.userQueryId++;
        return new Promise(function (resolve, reject) {
            var handler = function (p) {
                if (p.nArg1 === queryId) {
                    _this.removeListener("USERNAMELOOKUP", handler);
                    if (typeof p.sMessage === "string" || p.sMessage === undefined) {
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
                    _this.TxCmd(Constants_1.FCTYPE.USERNAMELOOKUP, 0, queryId, user);
                    break;
                case "string":
                    _this.TxCmd(Constants_1.FCTYPE.USERNAMELOOKUP, 0, queryId, 0, user);
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
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] connect(" + doLogin + ")");
        this.choseToLogIn = doLogin;
        return new Promise(function (resolve, reject) {
            _this.streamBuffer = new Buffer(0);
            _this.streamBufferPosition = 0;
            _this.trafficCounter = 0;
            _this.ensureServerConfigIsLoaded().then(function () {
                var chatServer = _this.serverConfig.chat_servers[Math.floor(Math.random() * _this.serverConfig.chat_servers.length)];
                Utils_1.logWithLevel(Utils_1.LogLevel.INFO, "Connecting to MyFreeCams chat server " + chatServer + "...");
                _this.client = _this.net.connect(8100, chatServer + ".myfreecams.com", function () {
                    _this.client.on("data", function (data) {
                        _this._readData(data);
                    });
                    _this.client.on("end", function () {
                        _this.disconnected();
                    });
                    if (doLogin) {
                        _this.login();
                    }
                    _this.currentlyConnected = true;
                    Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] emitting: CLIENT_CONNECTED, doLogin: " + doLogin);
                    _this.emit("CLIENT_CONNECTED", doLogin);
                    resolve();
                });
                _this.keepAlive = setInterval(function () {
                    if (this.trafficCounter > 2 && (this.loginPacketReceived || !doLogin)) {
                        this.TxCmd(Constants_1.FCTYPE.NULL, 0, 0, 0);
                    }
                    else {
                        Utils_1.logWithLevel(Utils_1.LogLevel.INFO, "Server has not responded in over 2 minutes. Trying to reconnect now.");
                        this.client.removeAllListeners("end");
                        this.client.end();
                        this.client = undefined;
                        this.disconnected();
                    }
                    this.trafficCounter = 0;
                }.bind(_this), 120 * 1000);
            });
        });
    };
    Client.prototype.disconnected = function () {
        var _this = this;
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] disconnected()");
        this.currentlyConnected = false;
        clearInterval(this.keepAlive);
        if (Client.connectedClientCount > 0) {
            Client.connectedClientCount--;
            Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] connectedClientCount: " + Client.connectedClientCount);
        }
        this.loginPacketReceived = false;
        if (this.password === "guest" && this.username.startsWith("Guest")) {
            this.username = "guest";
        }
        if (!this.manualDisconnect) {
            Utils_1.logWithLevel(Utils_1.LogLevel.INFO, "Disconnected from MyFreeCams.  Reconnecting in " + Client.currentReconnectSeconds + " seconds...");
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(function () {
                _this.connect(_this.choseToLogIn).catch(function (r) {
                    Utils_1.logWithLevel(Utils_1.LogLevel.ERROR, "Connection failed: " + r);
                    _this.disconnected();
                });
            }, Client.currentReconnectSeconds * 1000);
            if (Client.currentReconnectSeconds < Client.maximumReconnectSeconds) {
                Client.currentReconnectSeconds *= 2;
            }
        }
        else {
            this.manualDisconnect = false;
        }
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] emitting: CLIENT_DISCONNECTED, choseToLogIn: " + this.choseToLogIn);
        this.emit("CLIENT_DISCONNECTED", this.choseToLogIn);
        if (Client.connectedClientCount === 0) {
            Model_1.Model.reset();
        }
    };
    Client.prototype.login = function (username, password) {
        Client.connectedClientCount++;
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] connectedClientCount: " + Client.connectedClientCount);
        if (username !== undefined) {
            this.username = username;
        }
        if (password !== undefined) {
            this.password = password;
        }
        this.TxCmd(Constants_1.FCTYPE.LOGIN, 0, 20071025, 0, this.username + ":" + this.password);
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
        var _this = this;
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, "[CLIENT] disconnect(), this.client is " + (this.client !== undefined ? "defined" : "undefined"));
        return new Promise(function (resolve) {
            if (_this.client !== undefined) {
                _this.manualDisconnect = true;
                clearInterval(_this.keepAlive);
                clearTimeout(_this.reconnectTimer);
                _this.reconnectTimer = undefined;
                if (_this.currentlyConnected) {
                    _this.once("CLIENT_DISCONNECTED", function () {
                        resolve();
                    });
                }
                _this.client.end();
                _this.client = undefined;
                if (!_this.currentlyConnected) {
                    resolve();
                }
            }
            else {
                resolve();
            }
        });
    };
    return Client;
}());
Client.connectedClientCount = 0;
Client.initialReconnectSeconds = 15;
Client.maximumReconnectSeconds = 1920;
Client.currentReconnectSeconds = 15;
exports.Client = Client;
Utils_1.applyMixins(Client, [events_1.EventEmitter]);
//# sourceMappingURL=Client.js.map