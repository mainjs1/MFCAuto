"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const Utils_1 = require("./Utils");
const Constants_1 = require("./Constants");
const Model_1 = require("./Model");
const Packet_1 = require("./Packet");
const assert = require("assert");
class Client {
    constructor(username = "guest", password = "guest") {
        this.choseToLogIn = false;
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
    _readData(buf) {
        this.streamBuffer = Buffer.concat([this.streamBuffer, buf]);
        this._readPacket();
    }
    _packetReceived(packet) {
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
                    let msg = packet.sMessage;
                    let lv = msg.lv;
                    let uid = msg.uid;
                    let sid = msg.sid;
                    if (uid === 0 && sid > 0) {
                        uid = sid;
                    }
                    if (uid === undefined && packet.aboutModel) {
                        uid = packet.aboutModel.uid;
                    }
                    if (uid !== undefined && uid !== -1 && (lv === undefined || lv === Constants_1.FCLEVEL.MODEL)) {
                        let possibleModel = Model_1.Model.getModel(uid, lv === Constants_1.FCLEVEL.MODEL);
                        if (possibleModel !== undefined) {
                            possibleModel.merge(msg);
                        }
                    }
                }
                break;
            case Constants_1.FCTYPE.TAGS:
                let tagPayload = packet.sMessage;
                if (tagPayload) {
                    for (let key in tagPayload) {
                        if (tagPayload.hasOwnProperty(key)) {
                            let possibleModel = Model_1.Model.getModel(key);
                            if (possibleModel !== undefined) {
                                possibleModel.mergeTags(tagPayload[key]);
                            }
                        }
                    }
                }
                break;
            case Constants_1.FCTYPE.BOOKMARKS:
                let msg = packet.sMessage;
                if (Array.isArray(msg.bookmarks)) {
                    msg.bookmarks.forEach((b) => {
                        let possibleModel = Model_1.Model.getModel(b.uid);
                        if (possibleModel !== undefined) {
                            possibleModel.merge(b);
                        }
                    });
                }
                break;
            case Constants_1.FCTYPE.EXTDATA:
                if (packet.nTo === this.sessionId && packet.nArg2 === Constants_1.FCWOPT.REDIS_JSON) {
                    this._handleExtData(packet.sMessage);
                }
                break;
            case Constants_1.FCTYPE.METRICS:
                break;
            case Constants_1.FCTYPE.MANAGELIST:
                if (packet.nArg2 > 0 && packet.sMessage && packet.sMessage.rdata) {
                    let rdata = this.processListData(packet.sMessage.rdata);
                    let nType = packet.nArg2;
                    switch (nType) {
                        case Constants_1.FCL.ROOMMATES:
                            if (Array.isArray(rdata)) {
                                rdata.forEach((viewer) => {
                                    if (viewer) {
                                        let possibleModel = Model_1.Model.getModel(viewer.uid, viewer.lv === Constants_1.FCLEVEL.MODEL);
                                        if (possibleModel !== undefined) {
                                            possibleModel.merge(viewer);
                                        }
                                    }
                                });
                            }
                            break;
                        case Constants_1.FCL.CAMS:
                            if (Array.isArray(rdata)) {
                                rdata.forEach((model) => {
                                    if (model) {
                                        let possibleModel = Model_1.Model.getModel(model.uid, model.lv === Constants_1.FCLEVEL.MODEL);
                                        if (possibleModel !== undefined) {
                                            possibleModel.merge(model);
                                        }
                                    }
                                });
                                if (!this.completedModels) {
                                    this.completedModels = true;
                                    Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_MODELSLOADED`);
                                    this.emit("CLIENT_MODELSLOADED");
                                }
                            }
                            break;
                        case Constants_1.FCL.FRIENDS:
                            if (Array.isArray(rdata)) {
                                rdata.forEach((model) => {
                                    if (model) {
                                        let possibleModel = Model_1.Model.getModel(model.uid, model.lv === Constants_1.FCLEVEL.MODEL);
                                        if (possibleModel !== undefined) {
                                            possibleModel.merge(model);
                                        }
                                    }
                                });
                            }
                            break;
                        case Constants_1.FCL.IGNORES:
                            if (Array.isArray(rdata)) {
                                rdata.forEach((user) => {
                                    if (user) {
                                        let possibleModel = Model_1.Model.getModel(user.uid, user.lv === Constants_1.FCLEVEL.MODEL);
                                        if (possibleModel !== undefined) {
                                            possibleModel.merge(user);
                                        }
                                    }
                                });
                            }
                            break;
                        case Constants_1.FCL.TAGS:
                            let tagPayload2 = rdata;
                            if (tagPayload2) {
                                for (let key in tagPayload2) {
                                    if (tagPayload2.hasOwnProperty(key)) {
                                        let possibleModel = Model_1.Model.getModel(key);
                                        if (possibleModel !== undefined) {
                                            possibleModel.mergeTags(tagPayload2[key]);
                                        }
                                    }
                                }
                            }
                            break;
                        default:
                            Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _packetReceived unhandled list type on MANAGELIST packet: ${nType}`);
                    }
                }
                break;
            default:
                break;
        }
        this.emit(Constants_1.FCTYPE[packet.FCType], packet);
        this.emit(Constants_1.FCTYPE[Constants_1.FCTYPE.ANY], packet);
    }
    _readPacket() {
        let pos = this.streamBufferPosition;
        let intParams = [];
        let strParam;
        try {
            for (let i = 0; i < 7; i++) {
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
            let strParam2;
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
    }
    _handleExtData(extData) {
        return __awaiter(this, void 0, void 0, function* () {
            if (extData && extData.respkey) {
                let url = "http://www.myfreecams.com/php/FcwExtResp.php?";
                ["respkey", "type", "opts", "serv"].forEach((name) => {
                    url += `${name}=${extData[name]}&`;
                });
                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _handleExtData: ${JSON.stringify(extData)} - '${url}'`);
                let contents = "";
                try {
                    contents = yield Utils_1.httpGet(url);
                    Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _handleExtData response: ${JSON.stringify(extData)} - '${url}'\n\t${contents.slice(0, 80)}...`);
                    let p = new Packet_1.Packet(extData.msg.type, extData.msg.from, extData.msg.to, extData.msg.arg1, extData.msg.arg2, extData.msglen, JSON.parse(contents));
                    this._packetReceived(p);
                }
                catch (e) {
                    Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _handleExtData error: ${e} - ${JSON.stringify(extData)} - '${url}'\n\t${contents.slice(0, 80)}...`);
                }
            }
        });
    }
    processListData(rdata) {
        if (Array.isArray(rdata) && rdata.length > 0) {
            let result = [];
            let schema = rdata[0];
            let schemaMap = [];
            Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _processListData, processing schema: ${JSON.stringify(schema)}`);
            if (Array.isArray(schema) && rdata.length > 0) {
                schema.forEach((prop) => {
                    if (typeof prop === "object") {
                        Object.keys(prop).forEach((key) => {
                            if (Array.isArray(prop[key])) {
                                prop[key].forEach((prop2) => {
                                    schemaMap.push([key, prop2]);
                                });
                            }
                            else {
                                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _processListData. N-level deep schemas? ${JSON.stringify(schema)}`);
                            }
                        });
                    }
                    else {
                        schemaMap.push(prop);
                    }
                });
                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _processListData. Calculated schema map: ${JSON.stringify(schemaMap)}`);
                rdata.slice(1).forEach((record) => {
                    if (Array.isArray(record)) {
                        let msg = {};
                        for (let i = 0; i < record.length; i++) {
                            if (schemaMap.length > i) {
                                let path = schemaMap[i];
                                if (typeof path === "string") {
                                    msg[path] = record[i];
                                }
                                else if (path.length === 2) {
                                    if (msg[path[0]] === undefined) {
                                        msg[path[0]] = {};
                                    }
                                    msg[path[0]][path[1]] = record[i];
                                }
                                else {
                                    Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _processListData. N-level deep schemas? ${JSON.stringify(schema)}`);
                                }
                            }
                            else {
                                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _processListData. Not enough elements in schema\n\tSchema: ${JSON.stringify(schema)}\n\tSchemaMap: ${JSON.stringify(schemaMap)}\n\tData: ${JSON.stringify(record)}`);
                            }
                        }
                        result.push(msg);
                    }
                    else {
                        result.push(record);
                    }
                });
            }
            else {
                Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] _processListData. Malformed list data? ${JSON.stringify(schema)} - ${JSON.stringify(rdata)}`);
            }
            return result;
        }
        else {
            return rdata;
        }
    }
    EncodeRawChat(rawMsg) {
        return new Promise((resolve, reject) => {
            if (rawMsg.match(/^\s*$/) || !rawMsg.match(/:/)) {
                resolve(rawMsg);
                return;
            }
            rawMsg = rawMsg.replace(/`/g, "'");
            rawMsg = rawMsg.replace(/<~/g, "'");
            rawMsg = rawMsg.replace(/~>/g, "'");
            this.ensureEmoteParserIsLoaded().then(() => {
                this.emoteParser.Process(rawMsg, resolve);
            });
        });
    }
    loadFromMFC(url, massager) {
        return __awaiter(this, void 0, void 0, function* () {
            let load = require("load");
            let contents = yield Utils_1.httpGet(url);
            if (massager !== undefined) {
                contents = massager(contents);
            }
            return (load.compiler(contents));
        });
    }
    ensureEmoteParserIsLoaded() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.emoteParser === undefined) {
                let obj = yield this.loadFromMFC("http://www.myfreecams.com/_js/mfccore.js", (content) => {
                    let startIndex = content.indexOf("// js_build_core: MfcJs/ParseEmoteInput/ParseEmoteInput.js");
                    let endIndex = content.indexOf("// js_build_core: ", startIndex + 1);
                    assert.ok(startIndex !== -1 && endIndex !== -1 && startIndex < endIndex, "mfccore.js layout has changed, don't know what to do now");
                    content = content.substr(startIndex, endIndex - startIndex);
                    content = "var document = {cookie: '', domain: 'myfreecams.com', location: { protocol: 'http:' }};var XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;function bind(that,f){return f.bind(that);}" + content;
                    content = content.replace(/this.createRequestObject\(\)/g, "new XMLHttpRequest()");
                    content = content.replace(/new MfcImageHost\(\)/g, "{host: function(){return '';}}");
                    content = content.replace(/this\.Reset\(\);/g, "this.Reset();this.oReq = new XMLHttpRequest();");
                    content = content.replace(/MfcClientRes/g, "undefined");
                    return content;
                });
                this.emoteParser = new obj.ParseEmoteInput();
                this.emoteParser.setUrl("http://api.myfreecams.com/parseEmote");
            }
        });
    }
    ensureServerConfigIsLoaded() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.serverConfig === undefined) {
                let obj = yield this.loadFromMFC(`http://www.myfreecams.com/_js/serverconfig.js?nc=${Math.random()}`, (text) => {
                    return "var serverConfig = " + text;
                });
                this.serverConfig = obj.serverConfig;
            }
        });
    }
    TxCmd(nType, nTo = 0, nArg1 = 0, nArg2 = 0, sMsg) {
        Utils_1.logWithLevel(Utils_1.LogLevel.VERBOSE, "TxCmd Sending - nType: " + nType + ", nTo: " + nTo + ", nArg1: " + nArg1 + ", nArg2: " + nArg2 + ", sMsg:" + sMsg);
        if (sMsg && (nType === Constants_1.FCTYPE.CMESG || nType === Constants_1.FCTYPE.PMESG)) {
            if (sMsg.match(/([\u0000-\u001f\u0022-\u0026\u0080-\uffff]+)/)) {
                sMsg = escape(sMsg).replace(/%20/g, " ");
            }
        }
        let msgLength = (sMsg ? sMsg.length : 0);
        let buf = new Buffer((7 * 4) + msgLength);
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
    }
    TxPacket(packet) {
        this.TxCmd(packet.FCType, packet.nTo, packet.nArg1, packet.nArg2, JSON.stringify(packet.sMessage));
    }
    static toUserId(id) {
        if (id > 100000000) {
            id = id - 100000000;
        }
        return id;
    }
    static toRoomId(id) {
        if (id < 100000000) {
            id = id + 100000000;
        }
        return id;
    }
    sendChat(id, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            let encodedMsg = yield this.EncodeRawChat(msg);
            id = Client.toRoomId(id);
            this.TxCmd(Constants_1.FCTYPE.CMESG, id, 0, 0, encodedMsg);
        });
    }
    sendPM(id, msg) {
        return __awaiter(this, void 0, void 0, function* () {
            let encodedMsg = yield this.EncodeRawChat(msg);
            id = Client.toUserId(id);
            this.TxCmd(Constants_1.FCTYPE.PMESG, id, 0, 0, encodedMsg);
        });
    }
    joinRoom(id) {
        return new Promise((resolve, reject) => {
            let roomId = Client.toRoomId(id);
            let modelId = Client.toUserId(id);
            let resultHandler = (p) => {
                if (p.aboutModel && p.aboutModel.uid === modelId) {
                    this.removeListener("JOINCHAN", resultHandler);
                    this.removeListener("ZBAN", resultHandler);
                    this.removeListener("BANCHAN", resultHandler);
                    this.removeListener("CMESG", resultHandler);
                    switch (p.FCType) {
                        case Constants_1.FCTYPE.CMESG:
                            resolve(p);
                            break;
                        case Constants_1.FCTYPE.JOINCHAN:
                            switch (p.nArg2) {
                                case Constants_1.FCCHAN.JOIN:
                                    resolve(p);
                                    break;
                                case Constants_1.FCCHAN.PART:
                                    reject(p);
                                    break;
                                default:
                                    Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] joinRoom received an unexpected JOINCHAN response ${p.toString()}`);
                                    break;
                            }
                            break;
                        case Constants_1.FCTYPE.ZBAN:
                        case Constants_1.FCTYPE.BANCHAN:
                            reject(p);
                            break;
                        default:
                            Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] joinRoom received the impossible`);
                            reject(p);
                            break;
                    }
                }
            };
            this.addListener("JOINCHAN", resultHandler);
            this.addListener("ZBAN", resultHandler);
            this.addListener("BANCHAN", resultHandler);
            this.addListener("CMESG", resultHandler);
            this.TxCmd(Constants_1.FCTYPE.JOINCHAN, 0, roomId, Constants_1.FCCHAN.JOIN);
        });
    }
    leaveRoom(id) {
        return __awaiter(this, void 0, void 0, function* () {
            id = Client.toRoomId(id);
            this.TxCmd(Constants_1.FCTYPE.JOINCHAN, 0, id, Constants_1.FCCHAN.PART);
        });
    }
    queryUser(user) {
        Client.userQueryId = Client.userQueryId || 20;
        let queryId = Client.userQueryId++;
        return new Promise((resolve, reject) => {
            let handler = (p) => {
                if (p.nArg1 === queryId) {
                    this.removeListener("USERNAMELOOKUP", handler);
                    if (typeof p.sMessage === "string" || p.sMessage === undefined) {
                        resolve(undefined);
                    }
                    else {
                        resolve(p.sMessage);
                    }
                }
            };
            this.on("USERNAMELOOKUP", handler);
            switch (typeof user) {
                case "number":
                    this.TxCmd(Constants_1.FCTYPE.USERNAMELOOKUP, 0, queryId, user);
                    break;
                case "string":
                    this.TxCmd(Constants_1.FCTYPE.USERNAMELOOKUP, 0, queryId, 0, user);
                    break;
                default:
                    throw new Error("Invalid argument");
            }
        });
    }
    connect(doLogin = true) {
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] connect(${doLogin})`);
        this.choseToLogIn = doLogin;
        return new Promise((resolve, reject) => {
            this.streamBuffer = new Buffer(0);
            this.streamBufferPosition = 0;
            this.trafficCounter = 0;
            this.ensureServerConfigIsLoaded().then(() => {
                let chatServer = this.serverConfig.chat_servers[Math.floor(Math.random() * this.serverConfig.chat_servers.length)];
                Utils_1.logWithLevel(Utils_1.LogLevel.INFO, "Connecting to MyFreeCams chat server " + chatServer + "...");
                this.client = this.net.connect(8100, chatServer + ".myfreecams.com", () => {
                    this.client.on("data", (data) => {
                        this._readData(data);
                    });
                    this.client.on("end", () => {
                        this.disconnected();
                    });
                    if (doLogin) {
                        this.login();
                    }
                    this.currentlyConnected = true;
                    Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_CONNECTED, doLogin: ${doLogin}`);
                    this.emit("CLIENT_CONNECTED", doLogin);
                    resolve();
                });
                this.keepAlive = setInterval(function () {
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
                }.bind(this), 120 * 1000);
            });
        });
    }
    disconnected() {
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] disconnected()`);
        this.currentlyConnected = false;
        this.completedModels = false;
        clearInterval(this.keepAlive);
        if (Client.connectedClientCount > 0) {
            Client.connectedClientCount--;
            Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] connectedClientCount: ${Client.connectedClientCount}`);
        }
        this.loginPacketReceived = false;
        if (this.password === "guest" && this.username.startsWith("Guest")) {
            this.username = "guest";
        }
        if (!this.manualDisconnect) {
            Utils_1.logWithLevel(Utils_1.LogLevel.INFO, `Disconnected from MyFreeCams.  Reconnecting in ${Client.currentReconnectSeconds} seconds...`);
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = setTimeout(() => {
                this.connect(this.choseToLogIn).catch((r) => {
                    Utils_1.logWithLevel(Utils_1.LogLevel.ERROR, `Connection failed: ${r}`);
                    this.disconnected();
                });
            }, Client.currentReconnectSeconds * 1000);
            if (Client.currentReconnectSeconds < Client.maximumReconnectSeconds) {
                Client.currentReconnectSeconds *= 2;
            }
        }
        else {
            this.manualDisconnect = false;
        }
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_DISCONNECTED, choseToLogIn: ${this.choseToLogIn}`);
        this.emit("CLIENT_DISCONNECTED", this.choseToLogIn);
        if (Client.connectedClientCount === 0) {
            Model_1.Model.reset();
        }
    }
    login(username, password) {
        Client.connectedClientCount++;
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] connectedClientCount: ${Client.connectedClientCount}`);
        if (username !== undefined) {
            this.username = username;
        }
        if (password !== undefined) {
            this.password = password;
        }
        this.TxCmd(Constants_1.FCTYPE.LOGIN, 0, 20071025, 0, this.username + ":" + this.password);
    }
    connectAndWaitForModels() {
        return new Promise((resolve, reject) => {
            this.once("CLIENT_MODELSLOADED", resolve);
            this.connect(true);
        });
    }
    disconnect() {
        Utils_1.logWithLevel(Utils_1.LogLevel.DEBUG, `[CLIENT] disconnect(), this.client is ${this.client !== undefined ? "defined" : "undefined"}`);
        return new Promise((resolve) => {
            if (this.client !== undefined) {
                this.manualDisconnect = true;
                clearInterval(this.keepAlive);
                clearTimeout(this.reconnectTimer);
                this.reconnectTimer = undefined;
                if (this.currentlyConnected) {
                    this.once("CLIENT_DISCONNECTED", () => {
                        resolve();
                    });
                }
                this.client.end();
                this.client = undefined;
                if (!this.currentlyConnected) {
                    resolve();
                }
            }
            else {
                resolve();
            }
        });
    }
}
Client.connectedClientCount = 0;
Client.initialReconnectSeconds = 15;
Client.maximumReconnectSeconds = 1920;
Client.currentReconnectSeconds = 15;
exports.Client = Client;
Utils_1.applyMixins(Client, [events_1.EventEmitter]);
//# sourceMappingURL=Client.js.map