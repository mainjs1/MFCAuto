import { AnyMessage, Message } from "./sMessages";
import { EventEmitter } from "events";
import { LogLevel, logWithLevel, applyMixins } from "./Utils";
import { MAGIC, FCTYPE, FCCHAN, FCWOPT, FCL } from "./Constants";
import { Model } from "./Model";
import { Packet } from "./Packet";
import { BaseMessage, ExtDataMessage, ManageListMessage } from "./sMessages";
import * as http from "http";
import * as assert from "assert";

// Forward definitions for the TypeScript compiler
declare var escape: (text: string) => string;
declare var unescape: (text: string) => string;

// Creates and maintains a TCP socket connection to MFC chat servers similar to
// the way the Flash client connects and communicates with MFC.
export class Client implements EventEmitter {
    public sessionId: number;
    public username: string;
    public password: string;
    public uid: number;

    private net: any;
    private choseToLogIn: boolean = false;
    private completedFriends: boolean = true;
    private completedModels: boolean = false;
    private serverConfig: ServerConfig;
    private streamBuffer: Buffer;
    private streamBufferPosition: number;
    private emoteParser: EmoteParser;
    private client: any;
    private keepAlive: number;
    private currentlyConnected: boolean;
    private manualDisconnect: boolean;
    private reconnectTimer?: NodeJS.Timer;
    private static userQueryId: number;
    private trafficCounter: number;
    private loginPacketReceived: boolean;
    private static connectedClientCount = 0;
    private static initialReconnectSeconds = 15;
    private static maximumReconnectSeconds = 1920; // 32 Minutes
    private static currentReconnectSeconds = 15;

    // By default, this client will log in as a guest.
    //
    // To log in with a real account you specify your username as normal text.
    // The password should be a hash of your real password and NOT your actual
    // plain text password.  I have not determined how the passwords are hashed
    // but you can discover the appropriate string to use by checking your browser
    // cookies after logging in via your browser.  In Firefox, go to Options->Privacy
    // and then "Show Cookies..." and search for "myfreecams".  You will see one
    // cookie named "passcode".  Select it and copy the value listed as "Content".
    // It will be a long string of lower case letters that looks like gibberish.
    // *That* is the password to use here.
    constructor(username: string = "guest", password: string = "guest") {
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

    // Instance EventEmitter methods
    public addListener: (event: string, listener: ClientEventCallback) => this;
    public on: (event: string, listener: ClientEventCallback) => this;
    public once: (event: string, listener: ClientEventCallback) => this;
    public prependListener: (event: string, listener: ClientEventCallback) => this;
    public prependOnceListener: (event: string, listener: ClientEventCallback) => this;
    public removeListener: (event: string, listener: ClientEventCallback) => this;
    public removeAllListeners: (event?: string) => this;
    public getMaxListeners: () => number;
    public setMaxListeners: (n: number) => this;
    public listeners: (event: string) => ClientEventCallback[];
    public emit: (event: string, ...args: any[]) => boolean;
    public eventNames: () => string[];
    public listenerCount: (type: string) => number;

    // Reads data from the socket as quickly as possible and stores it in an internal buffer
    // readData is invoked by the "on data" event of the net.client object currently handling
    // the TCP connection to the MFC servers.
    //
    // This is an internal method, don't call it directly.
    private _readData(buf: Buffer): void {
        this.streamBuffer = Buffer.concat([this.streamBuffer, buf]);

        // The new buffer might contain a complete packet, try to read to find out...
        this._readPacket();
    }

    // Called with a single, complete, packet.  This function processes the packet,
    // handling some special packets like FCTYPE_LOGIN, which gives our user name and
    // session ID when first logging in to mfc.  It then calls out to any registered
    // event handlers.
    //
    // This is an internal method, don't call it directly.
    private _packetReceived(packet: Packet): void {
        logWithLevel(LogLevel.TRACE, packet.toString());
        // @TODO - Consider incrementing this counter only on SESSIONSTATE packets
        this.trafficCounter++;

        // Special case some packets to update and maintain internal state
        switch (packet.FCType) {
            case FCTYPE.LOGIN:
                // Store username and session id returned by the login response packet
                if (packet.nArg1 !== 0) {
                    logWithLevel(LogLevel.ERROR, "Login failed for user '" + this.username + "' password '" + this.password + "'");
                    throw new Error("Login failed");
                } else {
                    this.sessionId = packet.nTo;
                    this.uid = packet.nArg2;
                    this.username = packet.sMessage as string;
                    logWithLevel(LogLevel.INFO, "Login handshake completed. Logged in as '" + this.username + "' with sessionId " + this.sessionId);
                    this.loginPacketReceived = true;
                    Client.currentReconnectSeconds = Client.initialReconnectSeconds;
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
            case FCTYPE.JOINCHAN:
                // According to the site code, these packets can all trigger a user state update

                // Except in these specific cases...
                if ((packet.FCType === FCTYPE.DETAILS && packet.nFrom === FCTYPE.TOKENINC) ||
                    (packet.FCType === FCTYPE.ROOMHELPER && packet.nArg2 < 100) ||
                    (packet.FCType === FCTYPE.JOINCHAN && packet.nArg2 === FCCHAN.PART)) {
                    break;
                }

                // Ok, we're good, merge if there's anything to merge
                if (packet.sMessage !== undefined) {
                    let lv = (packet.sMessage as Message).lv;
                    let uid = (packet.sMessage as Message).uid;
                    if (uid === undefined && packet.aboutModel) {
                        uid = packet.aboutModel.uid;
                    }

                    // Only merge models (when we can tell). Unfortunately not every SESSIONSTATE
                    // packet has a user level property. So this is no worse than we had been doing
                    // before in terms of merging non-models...
                    if (uid !== undefined && uid !== -1 && (lv === undefined || lv === 4)) {
                        // If we know this is a model, get her instance and create it
                        // if it does not exist.  Otherwise, don't create an instance
                        // for someone that might not be a mdoel.
                        let possibleModel = Model.getModel(uid, lv === 4);
                        if (possibleModel !== undefined) {
                            possibleModel.mergePacket(packet);
                        }
                    }
                }
                break;
            case FCTYPE.TAGS:
                let tagPayload: any = packet.sMessage;
                for (let key in tagPayload) {
                    if (tagPayload.hasOwnProperty(key)) {
                        let possibleModel = Model.getModel(key);
                        if (possibleModel !== undefined) {
                            possibleModel.mergePacket(packet);
                        }
                    }
                }
                break;
            case FCTYPE.BOOKMARKS:
                // @TODO - @BUGBUG - this can also trigger a model state update...
                /*
                    case FCTYPE_BOOKMARKS:
                    {
                        var hBookmarks = ParseJSON(decodeURIComponent(sPayload));
                        if (hBookmarks.bookmarks) {
                            for (var a = 0; a < hBookmarks.bookmarks.length; a++) {
                                Bookmarks.hBookmarkedUsers[hBookmarks.bookmarks[a].uid] = true;
                                if (!g_hUsers[hBookmarks.bookmarks[a].uid]) {
                                    StoreUserHash(hBookmarks.bookmarks[a], {
                */
                //  log(packet.toString());
                //  assert.fail("@TODO - We're not merging in bookmarks packets yet unfortunately...");
                //  process.exit(1);
                break;
            case FCTYPE.EXTDATA:
                if (packet.nTo === this.sessionId && packet.nArg2 === FCWOPT.REDIS_JSON) {
                    this._handleExtData(packet.sMessage as ExtDataMessage);
                }
                break;
            case FCTYPE.METRICS:
                // For METRICS, nTO is an FCTYPE indicating the type of data that's
                // starting or ending, nArg1 is the count of data received so far, and nArg2
                // is the total count of data, so when nArg1 === nArg2, we're done for that data
                if (!(this.completedFriends && this.completedModels)) {
                    switch (packet.nTo as FCTYPE) {
                        case FCTYPE.ADDFRIEND:
                            if (packet.nArg1 !== packet.nArg2) {
                                this.completedFriends = false;
                            }
                            break;
                        case FCTYPE.SESSIONSTATE:
                            if (packet.nArg1 === packet.nArg2) {
                                this.completedModels = true;
                            }
                            if (this.completedFriends && this.completedModels) {
                                logWithLevel(LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_MODELSLOADED`);
                                this.emit("CLIENT_MODELSLOADED");
                            }
                            break;
                        default:
                            break;
                    }
                }
                break;
            case FCTYPE.MANAGELIST:
                if (packet.nArg2 > 0 && packet.sMessage && (packet.sMessage as ManageListMessage).rdata) {
                    let rdata: any = this._processListData((packet.sMessage as ManageListMessage).rdata);
                    let nType: FCL = packet.nArg2;

                    switch (nType as FCL) {
                        case FCL.ROOMMATES:
                            if (Array.isArray(rdata)) {
                                // Fake the previous signal of the start of a room viewers dump
                                this._packetReceived(new Packet(FCTYPE.METRICS, packet.nFrom, FCTYPE.JOINCHAN, 0, rdata.length, 0, undefined));
                                rdata.forEach((viewer: Message) => {
                                    this._packetReceived(new Packet(FCTYPE.JOINCHAN, packet.nFrom, packet.nTo, (packet.sMessage as ManageListMessage).channel, FCCHAN.JOIN, 0, viewer));
                                });
                                // Fake the previous signal of the end of a room viewers dump
                                this._packetReceived(new Packet(FCTYPE.METRICS, packet.nFrom, FCTYPE.JOINCHAN, rdata.length, rdata.length, 0, undefined));
                            }
                            break;
                        case FCL.CAMS:
                            if (Array.isArray(rdata)) {
                                // Fake the previous signal of the start of a model list dump
                                this._packetReceived(new Packet(FCTYPE.METRICS, packet.nFrom, FCTYPE.SESSIONSTATE, 0, rdata.length, 0, undefined));
                                rdata.forEach((model: Message) => {
                                    this._packetReceived(new Packet(FCTYPE.SESSIONSTATE, packet.nFrom, packet.nTo, packet.nArg1, model.uid, 0, model));
                                });
                                // Fake the previous signal of the end of a model list dump
                                this._packetReceived(new Packet(FCTYPE.METRICS, packet.nFrom, FCTYPE.SESSIONSTATE, rdata.length, rdata.length, 0, undefined));
                            }
                            break;
                        case FCL.FRIENDS:
                            if (Array.isArray(rdata)) {
                                // Fake the previous signal of the start of a friend list dump
                                this._packetReceived(new Packet(FCTYPE.METRICS, packet.nFrom, FCTYPE.ADDFRIEND, 0, rdata.length, 0, undefined));
                                rdata.forEach((model: Message) => {
                                    this._packetReceived(new Packet(FCTYPE.ADDFRIEND, packet.nFrom, packet.nTo, model.uid, packet.nArg2, 0, model));
                                });
                                // Fake the previous signal of the end of a friend list dump
                                this._packetReceived(new Packet(FCTYPE.METRICS, packet.nFrom, FCTYPE.ADDFRIEND, rdata.length, rdata.length, 0, undefined));
                            }
                            break;
                        case FCL.IGNORES:
                            if (Array.isArray(rdata)) {
                                // Fake the previous signal of the start of a ignore list dump
                                this._packetReceived(new Packet(FCTYPE.METRICS, packet.nFrom, FCTYPE.ADDIGNORE, 0, rdata.length, 0, undefined));
                                rdata.forEach((user: Message) => {
                                    this._packetReceived(new Packet(FCTYPE.ADDIGNORE, packet.nFrom, packet.nTo, user.uid, packet.nArg2, 0, user));
                                });
                                // Fake the previous signal of the end of a ignore list dump
                                this._packetReceived(new Packet(FCTYPE.METRICS, packet.nFrom, FCTYPE.ADDIGNORE, rdata.length, rdata.length, 0, undefined));
                            }
                            break;
                        case FCL.TAGS:
                            // @TODO - Could fake Tags metrics here, but I wasn't ever using it and it's unlikely anyone else was either
                            if (typeof rdata === "object") {
                                // Fake a tags packet
                                this._packetReceived(new Packet(FCTYPE.TAGS, packet.nFrom, packet.nTo, packet.nArg1, packet.nArg2, packet.sPayload, rdata));
                            }
                            break;
                        default:
                            logWithLevel(LogLevel.DEBUG, `[CLIENT] _packetReceived unhandled list type on MANAGELIST packet: ${nType}`);
                    }
                }
                break;
            default:
                break;
        }

        // Fire this packet's event for any listeners
        this.emit(FCTYPE[packet.FCType], packet);
        this.emit(FCTYPE[FCTYPE.ANY], packet);
    }

    // Parses the MFC stream buffer, for each complete individual packet
    // it receives, it will call packetReceived.  Because of the single-threaded async nature of node.js, there will often be
    // partial packets and need to handle that gracefully, only calling packetReceived once
    // we've parsed out a complete response...
    //
    // This is an internal method, don't call it directly.
    private _readPacket(): void {
        let pos: number = this.streamBufferPosition;
        let intParams: number[] = [];
        let strParam: string | undefined;

        try {
            // Each incoming packet is initially tagged with 7 int32 values, they look like this:
            //  0 = "Magic" value that is *always* -2027771214
            //  1 = "FCType" that identifies the type of packet this is (FCType being a MyFreeCams defined thing)
            //  2 = nFrom
            //  3 = nTo
            //  4 = nArg1
            //  5 = nArg2
            //  6 = sPayload, the size of the payload
            //  7 = sMessage, the actual payload.  This is not an int but is the actual buffer

            // Any read here could throw a RangeError exception for reading beyond the end of the buffer.  In theory we could handle this
            // better by checking the length before each read, but that would be a bit ugly.  Instead we handle the RangeErrors and just
            // try to read again the next time the buffer grows and we have more data


            // Parse out the first 7 integer parameters (Magic, FCType, nFrom, nTo, nArg1, nArg2, sPayload)
            for (let i = 0; i < 7; i++) {
                intParams.push(this.streamBuffer.readInt32BE(pos));
                pos += 4;
            }
            // If the first integer is MAGIC, we have a valid packet
            if (intParams[0] === MAGIC) {
                // If there is a JSON payload to this packet
                if (intParams[6] > 0) {
                    // If we don't have the complete payload in the buffer already, bail out and retry after we get more data from the network
                    if (pos + intParams[6] > this.streamBuffer.length) {
                        throw new RangeError(); // This is needed because streamBuffer.toString will not throw a rangeerror when the last param is out of the end of the buffer
                    }
                    // We have the full packet, store it and move our buffer pointer to the next packet
                    strParam = this.streamBuffer.toString("utf8", pos, pos + intParams[6]);
                    pos = pos + intParams[6];
                }
            } else {
                // Magic value did not match?  In that case, all bets are off.  We no longer understand the MFC stream and cannot recover...
                // This is usually caused by a mis-alignment error due to incorrect buffer management (bugs in this code or the code that writes the buffer from the network)
                throw new Error("Invalid packet received! - " + intParams[0] + " Length == " + this.streamBuffer.length);
            }

            // At this point we have the full packet in the intParams and strParam values, but intParams is an unstructured array
            // Let's clean it up before we delegate to this.packetReceived.  (Leaving off the magic int, because it MUST be there always
            // and doesn't add anything to the understanding)
            let strParam2: AnyMessage | undefined;
            if (strParam) {
                try {
                    strParam2 = JSON.parse(strParam);
                } catch (e) {
                    strParam2 = strParam;
                }
            }
            this._packetReceived(new Packet(
                intParams[1], // FCType
                intParams[2], // nFrom
                intParams[3], // nTo
                intParams[4], // nArg1
                intParams[5], // nArg2
                intParams[6], // sPayload
                strParam2 // sMessage
            ));

            // If there's more to read, keep reading (which would be the case if the network sent >1 complete packet in a single transmission)
            if (pos < this.streamBuffer.length) {
                this.streamBufferPosition = pos;
                this._readPacket();
            } else {
                // We read the full buffer, clear the buffer cache so that we can
                // read cleanly from the beginning next time (and save memory)
                this.streamBuffer = new Buffer(0);
                this.streamBufferPosition = 0;
            }
        } catch (e) {
            // RangeErrors are expected because sometimes the buffer isn't complete.  Other errors are not...
            if (e.toString().indexOf("RangeError") !== 0) {
                throw e;
            } else {
                //  this.log("Expected exception (?): " + e);
            }
        }
    }

    private _handleExtData(extData: ExtDataMessage) {
        if (extData && extData.respkey) {
            let url = "http://www.myfreecams.com/php/FcwExtResp.php?";
            ["respkey", "type", "opts", "serv"].forEach((name) => {
                url += `${name}=${(extData as any)[name]}&`;
            });

            logWithLevel(LogLevel.DEBUG, `[CLIENT] _handleExtData: ${JSON.stringify(extData)} - '${url}'`);
            http.get(url, (res: any) => {
                let contents = "";
                res.on("data", (chunk: string) => {
                    contents += chunk;
                });
                res.on("end", () => {
                    try {
                        logWithLevel(LogLevel.DEBUG, `[CLIENT] _handleExtData response: ${JSON.stringify(extData)} - '${url}'\n\t${contents.slice(0, 80)}...`);
                        let p = new Packet(extData.msg.type, extData.msg.from, extData.msg.to, extData.msg.arg1, extData.msg.arg2, extData.msglen, JSON.parse(contents));
                        this._packetReceived(p);
                    } catch (e) {
                        logWithLevel(LogLevel.DEBUG, `[CLIENT] _handleExtData invalid JSON: ${JSON.stringify(extData)} - '${url}'\n\t${contents.slice(0, 80)}...`);
                    }
                });
            }).on("error", (e: any) => {
                logWithLevel(LogLevel.DEBUG, `[CLIENT] _handleExtData error: ${e} - ${JSON.stringify(extData)} - '${url}'`);
            });

        }
    }

    private _processListData(rdata: any): any {
        // Really MFC?  Really??  Ok, commence the insanity...
        if (Array.isArray(rdata) && rdata.length > 0) {
            let result: Array<BaseMessage> = [];
            let schema: any[] = rdata.shift();
            let schemaMap: Map<number, string[]> = new Map() as Map<number, string[]>;
            let schemaMapIndex = 0;

            logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData, processing schema: ${JSON.stringify(schema)}`);

            if (schema !== undefined && rdata.length > 0) {
                // Build a map of array index -> property path from the schema
                schema.forEach((prop) => {
                    if (typeof prop === "object") {
                        Object.keys(prop).forEach((key) => {
                            if (Array.isArray(prop[key])) {
                                prop[key].forEach((prop2: string) => {
                                    schemaMap.set(schemaMapIndex++, [key, prop2]);
                                });
                            } else {
                                logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData. N-level deep schemas? ${JSON.stringify(schema)}`);
                            }
                        });
                    } else {
                        schemaMap.set(schemaMapIndex++, [prop]);
                    }
                });
                rdata.forEach((record: Array<string | number>) => {
                    if (Array.isArray(record)) {
                        // Now apply the schema
                        let msg: any = {};
                        for (let i = 0; i < record.length; i++) {
                            if (schemaMap.has(i)) {
                                let path = schemaMap.get(i);
                                if (path.length === 1) {
                                    msg[path[0]] = record[i];
                                } else if (path.length === 2) {
                                    if (msg[path[0]] === undefined) {
                                        msg[path[0]] = {};
                                    }
                                    msg[path[0]][path[1]] = record[i];
                                } else {
                                    logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData. N-level deep schemas? ${JSON.stringify(schema)}`);
                                }
                            } else {
                                logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData. Not enough elements in schema\n\tSchema: ${JSON.stringify(schema)}\n\tData: ${JSON.stringify(record)}`);
                            }
                        }

                        result.push(msg);
                    } else {
                        result.push(record);
                    }
                });
            } else {
                logWithLevel(LogLevel.DEBUG, `[CLIENT] _processListData. Malformed list data? ${JSON.stringify(schema)} - ${JSON.stringify(rdata)}`);
            }

            return result;
        } else {
            return rdata;
        }
    }

    // Takes an input chat string as you would type it in browser in an MFC
    // chat room, like "I am happy :mhappy", and formats the message as MFC
    // would internally before sending it to the server, "I am happy #~ue,2c9d2da6.gif,mhappy~#"
    // in the given example.
    //
    // On the MFC site, this code is part of the ParseEmoteInput function in
    // http://www.myfreecams.com/_js/mfccore.js, and it is especially convoluted
    // code involving ajax requests back to the server depending on the text you're
    // sending and a giant hashtable of known emotes.
    //
    // Note that if the text you want to send does not have any emotes, you can
    // directly use TxCmd with the raw string (or possibly the escape(string) but
    // that's easy enough)
    public EncodeRawChat(rawMsg: string): Promise<string> {
        if (arguments.length !== 1) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }

        return new Promise((resolve, reject) => {
            // Pre-filters mostly taken from player.html's SendChat method
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

    // Dynamically loads script code from MFC, massaging it with the given massager
    // function first, and then passes the resulting instantiated object to the
    // given callback.
    //
    // We try to use this sparingly as it opens us up to breaks from site changes.
    // But it is still useful for the more complex or frequently updated parts
    // of MFC.
    private loadFromMFC(url: string, massager?: (src: string) => string): Promise<any> {
        if (arguments.length > 2) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise((resolve, reject) => {
            let load: any = require("load");
            http.get(url, function (res: any) {
                let contents = "";
                res.on("data", function (chunk: string) {
                    contents += chunk;
                });
                res.on("end", function () {
                    try {
                        if (massager !== undefined) {
                            contents = massager(contents);
                        }
                        let mfcModule = load.compiler(contents);
                        resolve(mfcModule);
                    } catch (e) {
                        reject(e);
                    }
                });
            }).on("error", function (e: any) {
                reject(e);
            });
        });
    }

    // Loads the emote parsing code from the MFC web site directly, if it's not
    // already loaded, and then invokes the given callback.  This is useful because
    // most scripts won't actually need the emote parsing capabilities, so lazy
    // loading it can speed up the common case.
    //
    // We're loading this code from the live site instead of re-coding it ourselves
    // here because of the complexity of the code and the fact that it has changed
    // several times in the past.
    private ensureEmoteParserIsLoaded() {
        if (arguments.length !== 0) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise((resolve, reject) => {
            if (this.emoteParser !== undefined) {
                resolve();
            } else {
                this.loadFromMFC("http://www.myfreecams.com/_js/mfccore.js", (content) => {
                    // Massager....Yes this is vulnerable to site breaks, but then
                    // so is this entire module.

                    // First, pull out only the ParseEmoteInput function
                    let startIndex = content.indexOf("// js_build_core: MfcJs/ParseEmoteInput/ParseEmoteInput.js");
                    let endIndex = content.indexOf("// js_build_core: ", startIndex + 1);
                    assert.ok(startIndex !== -1 && endIndex !== -1 && startIndex < endIndex, "mfccore.js layout has changed, don't know what to do now");
                    content = content.substr(startIndex, endIndex - startIndex);

                    // Then massage the function somewhat and prepend some prerequisites
                    content = "var document = {cookie: '', domain: 'myfreecams.com', location: { protocol: 'http:' }};var XMLHttpRequest = require('xmlhttprequest').XMLHttpRequest;function bind(that,f){return f.bind(that);}" + content;
                    content = content.replace(/this.createRequestObject\(\)/g, "new XMLHttpRequest()");
                    content = content.replace(/new MfcImageHost\(\)/g, "{host: function(){return '';}}");
                    content = content.replace(/this\.Reset\(\);/g, "this.Reset();this.oReq = new XMLHttpRequest();");
                    content = content.replace(/MfcClientRes/g, "undefined");
                    return content;
                }).then((obj) => {
                    this.emoteParser = new obj.ParseEmoteInput();
                    this.emoteParser.setUrl("http://api.myfreecams.com/parseEmote");
                    resolve();
                }).catch((reason) => {
                    reject(reason);
                });
            }
        });
    }

    // Loads the lastest server information from MFC, if it's not already loaded
    private ensureServerConfigIsLoaded() {
        if (arguments.length !== 0) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise((resolve, reject) => {
            if (this.serverConfig !== undefined) {
                resolve();
            } else {
                this.loadFromMFC(`http://www.myfreecams.com/_js/serverconfig.js?nc=${Math.random()}`, (text) => {
                    return "var serverConfig = " + text;
                }).then((obj) => {
                    this.serverConfig = obj.serverConfig;
                    resolve();
                });
            }
        });
    }

    // Sends a message back to MFC in the expected packet format
    // usually nTo==0, nArg1==0, nArg2==0, sMsg==null
    public TxCmd(nType: FCTYPE, nTo: number = 0, nArg1: number = 0, nArg2: number = 0, sMsg?: string): void {
        logWithLevel(LogLevel.VERBOSE, "TxCmd Sending - nType: " + nType + ", nTo: " + nTo + ", nArg1: " + nArg1 + ", nArg2: " + nArg2 + ", sMsg:" + sMsg);
        if (sMsg && (nType === FCTYPE.CMESG || nType === FCTYPE.PMESG)) {
            if (sMsg.match(/([\u0000-\u001f\u0022-\u0026\u0080-\uffff]+)/)) { sMsg = escape(sMsg).replace(/%20/g, " "); }
        }

        let msgLength = (sMsg ? sMsg.length : 0);
        let buf = new Buffer((7 * 4) + msgLength);

        buf.writeInt32BE(MAGIC, 0);
        buf.writeInt32BE(nType, 4);
        buf.writeInt32BE(this.sessionId, 8); // Session id, this is always our nFrom value
        buf.writeInt32BE(nTo, 12);
        buf.writeInt32BE(nArg1, 16);
        buf.writeInt32BE(nArg2, 20);
        buf.writeInt32BE(msgLength, 24);

        if (sMsg) {
            buf.write(sMsg, 28);
        }

        if (this.client !== undefined) {
            this.client.write(buf);
        } else {
            throw new Error("Cannot call TxCmd on a disconnected client");
        }
    }

    public TxPacket(packet: Packet): void {
        this.TxCmd(packet.FCType, packet.nTo, packet.nArg1, packet.nArg2, JSON.stringify(packet.sMessage));
    }

    // Takes a number that might be a user id or a room
    // id and converts it to a user id (if necessary)
    public static toUserId(id: number): number {
        if (id > 100000000) {
            id = id - 100000000;
        }
        return id;
    }

    // Takes a number that might be a user id or a room
    // id and converts it to a room id (if necessary)
    public static toRoomId(id: number): number {
        if (id < 100000000) {
            id = id + 100000000;
        }
        return id;
    }


    // Send msg to the given model's chat room.
    //
    // If the message is one you intend to send more than once,
    // and your message contains emotes, you can save some processing
    // overhead by calling client.EncodeRawChat once for the string,
    // caching the result of that call, and passing that string here.
    //
    // Note that you must have previously joined the model's chat room
    // for the message to be sent successfully.
    //
    // Also note, this method has no callback currently, and your message
    // may fail to be sent successfully if you are muted or ignored by
    // the model.
    public sendChat(id: number, msg: string): void {
        this.EncodeRawChat(msg).then((encodedMsg) => {
            id = Client.toRoomId(id);
            this.TxCmd(FCTYPE.CMESG, id, 0, 0, encodedMsg);
        });
    }

    // Send msg to the given model via PM.
    //
    // If the message is one you intend to send more than once,
    // and your message contains emotes, you can save some processing
    // overhead by calling client.EncodeRawChat once for the string,
    // caching the result of that call, and passing that string here.
    //
    // Also note, this method has no callback currently, and your message
    // may fail to be sent successfully if you are ignored by the model or
    // do not have PM access (due to being a guest, etc).
    public sendPM(id: number, msg: string): void {
        this.EncodeRawChat(msg).then((encodedMsg) => {
            id = Client.toUserId(id);
            this.TxCmd(FCTYPE.PMESG, id, 0, 0, encodedMsg);
        });
    }

    // Joins the chat room of the given model
    public joinRoom(id: number): void {
        id = Client.toRoomId(id);
        this.TxCmd(FCTYPE.JOINCHAN, 0, id, FCCHAN.JOIN);
    }

    // Leaves the chat room of the given model
    public leaveRoom(id: number): void {
        id = Client.toRoomId(id);
        this.TxCmd(FCTYPE.JOINCHAN, 0, id, FCCHAN.PART); // @TODO - Confirm that this works, it's not been tested
    }

    // Looks up a user by username or id number and resolves with the Packet response.
    // If the user is a model, this will also have the side effect of updating her
    // MFCAuto state before the promise is resolved.
    public queryUser(user: string | number) {
        Client.userQueryId = Client.userQueryId || 20;
        let queryId = Client.userQueryId++;
        return new Promise((resolve, reject) => {
            let handler = (p: Packet) => {
                // If this is our response
                if (p.nArg1 === queryId) {
                    this.removeListener("USERNAMELOOKUP", handler);
                    if (typeof p.sMessage === "string" || p.sMessage === undefined) {
                        // These states mean the user wasn't found.
                        // Be a little less ambiguous in our response by resolving
                        // with undefined in both cases.
                        resolve(undefined);
                    } else {
                        resolve(p.sMessage);
                    }
                }
            };
            this.on("USERNAMELOOKUP", handler);
            switch (typeof user) {
                case "number":
                    this.TxCmd(FCTYPE.USERNAMELOOKUP, 0, queryId, user as number);
                    break;
                case "string":
                    this.TxCmd(FCTYPE.USERNAMELOOKUP, 0, queryId, 0, user as string);
                    break;
                default:
                    throw new Error("Invalid argument");
            }
        });
    }

    // Connects to MFC and optionally logs in with the credentials you supplied when
    // constructing this Client.
    //
    // Logging in is optional because not all queries to the server require you to log in.
    // For instance, MFC servers will respond to a USERNAMELOOKUP request without
    // requiring a login.
    public connect(doLogin: boolean = true) {
        if (arguments.length > 1) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        logWithLevel(LogLevel.DEBUG, `[CLIENT] connect(${doLogin})`);
        this.choseToLogIn = doLogin;
        return new Promise((resolve, reject) => {
            // Reset any read buffers so we are in a consistent state
            this.streamBuffer = new Buffer(0);
            this.streamBufferPosition = 0;
            this.trafficCounter = 0;

            this.ensureServerConfigIsLoaded().then(() => {
                let chatServer = this.serverConfig.chat_servers[Math.floor(Math.random() * this.serverConfig.chat_servers.length)];
                logWithLevel(LogLevel.INFO, "Connecting to MyFreeCams chat server " + chatServer + "...");

                this.client = this.net.connect(8100, chatServer + ".myfreecams.com", () => { // 'connect' listener
                    this.client.on("data", (data: any) => {
                        this._readData(data);
                    });
                    this.client.on("end", () => {
                        this.disconnected();
                    });

                    // Connecting without logging in is the rarer case, so make the default to log in
                    if (doLogin) {
                        this.login();
                    }

                    this.currentlyConnected = true;
                    logWithLevel(LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_CONNECTED, doLogin: ${doLogin}`);
                    this.emit("CLIENT_CONNECTED", doLogin);
                    resolve();
                });

                // Keep the server connection alive
                this.keepAlive = setInterval(
                    function () {
                        if (this.trafficCounter > 2 && (this.loginPacketReceived || !doLogin)) {
                            this.TxCmd(FCTYPE.NULL, 0, 0, 0);
                        } else {
                            // On rare occasions, I've seen us reach a zombie state with
                            // a connected socket but no traffic flowing. This is a guard
                            // against that.
                            //
                            // If we haven't received any packets, even a ping response,
                            // in 2+ minutes, then we may not really be connected anymore.
                            // Kill the connection and try reconnecting again...
                            logWithLevel(LogLevel.INFO, "Server has not responded in over 2 minutes. Trying to reconnect now.");
                            this.client.removeAllListeners("end");
                            this.client.end();
                            this.client = undefined;
                            this.disconnected();
                        }
                        this.trafficCounter = 0;
                    }.bind(this),
                    120 * 1000
                );
            });
        });
    }

    // Private method called when we lose a valid connection to the chat server
    // it handles the reconnect logic
    private disconnected() {
        logWithLevel(LogLevel.DEBUG, `[CLIENT] disconnected()`);
        this.currentlyConnected = false;
        clearInterval(this.keepAlive);
        if (Client.connectedClientCount > 0) {
            Client.connectedClientCount--;
            logWithLevel(LogLevel.DEBUG, `[CLIENT] connectedClientCount: ${Client.connectedClientCount}`);
        }
        this.loginPacketReceived = false;
        if (this.password === "guest" && this.username.startsWith("Guest")) {
            // If we had a successful guest login before, we'll have changed
            // username to something like Guest12345 or whatever the server assigned
            // to us. That is not valid to log in again, so reset it back to guest.
            this.username = "guest";
        }
        if (!this.manualDisconnect) {
            logWithLevel(LogLevel.INFO, `Disconnected from MyFreeCams.  Reconnecting in ${Client.currentReconnectSeconds} seconds...`);
            clearTimeout(this.reconnectTimer as NodeJS.Timer);
            this.reconnectTimer = setTimeout(() => {
                this.connect(this.choseToLogIn).catch((r) => {
                    logWithLevel(LogLevel.ERROR, `Connection failed: ${r}`);
                    this.disconnected();
                });
            }, Client.currentReconnectSeconds * 1000);
            // Gradually increase the reconnection time up to Client.maximumReconnectSeconds.
            // currentReconnectSeconds will be reset to initialReconnectSeconds once we have
            // successfully logged in.
            if (Client.currentReconnectSeconds < Client.maximumReconnectSeconds) {
                Client.currentReconnectSeconds *= 2;
            }
        } else {
            this.manualDisconnect = false;
        }
        logWithLevel(LogLevel.DEBUG, `[CLIENT] emitting: CLIENT_DISCONNECTED, choseToLogIn: ${this.choseToLogIn}`);
        this.emit("CLIENT_DISCONNECTED", this.choseToLogIn);
        if (Client.connectedClientCount === 0) {
            Model.reset();
        }
    }

    // Logs in to MFC.  This should only be called after Client connect(false);
    // See the comment on Client's constructor for details on the password to use.
    public login(username?: string, password?: string): void {
        // connectedClientCount is used to track when all clients receiving SESSIONSTATE
        // updates have disconnected, and as those are only sent for logged-in clients,
        // we shouldn't increment the counter for non-logged-in clients
        Client.connectedClientCount++;
        logWithLevel(LogLevel.DEBUG, `[CLIENT] connectedClientCount: ${Client.connectedClientCount}`);

        if (username !== undefined) {
            this.username = username;
        }
        if (password !== undefined) {
            this.password = password;
        }
        this.TxCmd(FCTYPE.LOGIN, 0, 20071025, 0, this.username + ":" + this.password);
    }

    // Connects to MFC and logs in, just like this.connect(true),
    // but in this version the callback is not invoked immediately
    // on socket connection, but instead when the initial list of
    // online models has been fully populated.
    // If you're logged in as a user with friended models, this will
    // also wait until your friends list is completely loaded.
    public connectAndWaitForModels() {
        if (arguments.length !== 0) {
            throw new Error("You may be using a deprecated version of this function. It has been converted to return a promise rather than taking a callback.");
        }
        return new Promise((resolve, reject) => {
            this.once("CLIENT_MODELSLOADED", resolve);
            this.connect(true);
        });
    }

    // Disconnects by closing the socket. There may be
    // more graceful ways of doing this, involving sending
    // some kind of logout message to the server or something
    // but whatever
    public disconnect() {
        logWithLevel(LogLevel.DEBUG, `[CLIENT] disconnect(), this.client is ${this.client !== undefined ? "defined" : "undefined"}`);
        return new Promise((resolve) => {
            if (this.client !== undefined) {
                this.manualDisconnect = true;
                clearInterval(this.keepAlive);
                clearTimeout(this.reconnectTimer as NodeJS.Timer);
                this.reconnectTimer = undefined;
                if (this.currentlyConnected) {
                    this.once("CLIENT_DISCONNECTED", () => {
                        resolve();
                    });
                }
                this.client.end();
                this.client = undefined;

                // If we're not currently connected, then calling
                // this.client.end() will not cause CLIENT_DISCONNECTED
                // to be emitted, so we shouldn't wait for that.
                if (!this.currentlyConnected) {
                    resolve();
                }
            } else {
                resolve();
            }
        });
    }
}
applyMixins(Client, [EventEmitter]);

export type ClientEventCallback = (packet?: Packet) => void;
type EmoteParserCallback = (parsedString: string, aMsg2: { txt: string; url: string; code: string }[]) => void;
interface EmoteParser {
    Process(msg: string, callback: EmoteParserCallback): void;
    setUrl(url: string): void;
}
interface ServerConfig {
    ajax_servers: string[];
    chat_servers: string[];
    h5video_servers: { [index: number]: string };
    release: boolean;
    video_servers: string[];
    websocket_servers: { [index: string]: string };
}
