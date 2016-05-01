/* @internal */
var EventEmitter: any = require("events").EventEmitter;
/* @internal */
var assert = require("assert");

// Creates and maintains a TCP socket connection to MFC chat servers similar to
// the way the Flash client connects and communicates with MFC.
class Client implements NodeJS.EventEmitter {
    public sessionId: number;
    public username: string;
    public password: string;
    public uid: number;

    private net: any;
    private debug: boolean = false; // Set to true to enable debug logging
    private serverConfig: ServerConfig;
    private streamBuffer: Buffer;
    private streamBufferPosition: number;
    private emoteParser: EmoteParser;
    private client: any;
    private keepAlive: number;
    private manualDisconnect: boolean;
    private static userQueryId: number;

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
    }

    // Instance EventEmitter methods
    public addListener: (event: string, listener: Function) => this;
    public on: (event: string, listener: Function) => this;
    public once: (event: string, listener: Function) => this;
    public removeListener: (event: string, listener: Function) => this;
    public removeAllListeners: (event?: string) => this;
    public getMaxListeners: () => number;
    public setMaxListeners: (n: number) => this;
    public listeners: (event: string) => Function[];
    public emit: (event: string, ...args: any[]) => boolean;
    public listenerCount: (type: string) => number;

    // Simple helper log function that adds a timestamp and supports filtering 'debug' only messages
    private log(msg: string, debugOnly: boolean = false): void {
        if (debugOnly && !this.debug) {
            return;
        }
        log(msg);
    }

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
        this.log(packet.toString(), true);

        // Special case some packets to update and maintain internal state
        switch (packet.FCType) {
            case FCTYPE.LOGIN:
                // Store username and session id returned by the login response packet
                if (packet.nArg1 !== 0) {
                    this.log("Login failed for user '" + this.username + "' password '" + this.password + "'");
                    throw new Error("Login failed");
                } else {
                    this.sessionId = packet.nTo;
                    this.uid = packet.nArg2;
                    this.username = packet.sMessage as string;
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
                    if (uid === undefined) {
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
                        Model.getModel(key).mergePacket(packet);
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
        let strParam: string;

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
            let strParam2: AnyMessage;
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
            let http: any = require("http");
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
                    let startIndex = content.indexOf("function ParseEmoteInput()");
                    let endIndex = content.indexOf("function ParseEmoteOutput()");
                    assert.ok(startIndex !== -1 && endIndex !== -1 && startIndex < endIndex, "mfccore.js layout has changed, don't know what to do now");
                    content = content.substr(startIndex, endIndex - startIndex);

                    // Then massage the function somewhat and prepend some prerequisites
                    content = "var document = {cookie: ''};var XMLHttpRequest = require('XMLHttpRequest').XMLHttpRequest;function bind(that,f){return f.bind(that);}" + content.replace(/createRequestObject\(\)/g, "new XMLHttpRequest()").replace(/new MfcImageHost\(\)/g, "{host: function(){return '';}}").replace(/this\.Reset\(\);/g, "this.Reset();this.oReq = new XMLHttpRequest();");
                    return content;
                }).then((obj) => {
                    this.emoteParser = new obj.ParseEmoteInput();
                    this.emoteParser.setUrl("http://www.myfreecams.com/mfc2/php/ParseChatStream.php");
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
                this.loadFromMFC("http://www.myfreecams.com/_js/serverconfig.js", (text) => {
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
    // @TODO - Should this use the Packet class instead or as an overload?
    public TxCmd(nType: FCTYPE, nTo: number = 0, nArg1: number = 0, nArg2: number = 0, sMsg?: string): void {
        this.log("TxCmd Sending - nType: " + nType + ", nTo: " + nTo + ", nArg1: " + nArg1 + ", nArg2: " + nArg2 + ", sMsg:" + sMsg, true);
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

        this.client.write(buf);
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
        return new Promise((resolve, reject) => {
            // Reset any read buffers so we are in a consistent state
            this.streamBuffer = new Buffer(0);
            this.streamBufferPosition = 0;

            this.ensureServerConfigIsLoaded().then(() => {
                let chatServer = this.serverConfig.chat_servers[Math.floor(Math.random() * this.serverConfig.chat_servers.length)];
                this.log("Connecting to MyFreeCams chat server " + chatServer + "...");

                this.hookModelsLoaded();

                this.client = this.net.connect(8100, chatServer + ".myfreecams.com", () => { // 'connect' listener
                    this.client.on("data", (data: any) => {
                        this._readData(data);
                    });
                    this.client.on("end", () => {
                        clearInterval(this.keepAlive);
                        if (this.password === "guest" && this.username.startsWith("Guest")) {
                            // If we had a successful guest login before, we'll have changed
                            // username to something like Guest12345 or whatever the server assigned
                            // to us. That is not valid to log in again, so reset it back to guest.
                            this.username = "guest";
                        }
                        if (!this.manualDisconnect) {
                            this.log("Disconnected from MyFreeCams.  Reconnecting in 30 seconds..."); //  Is 30 seconds reasonable?
                            setTimeout(this.connect.bind(this), 30000);
                        } else {
                            this.manualDisconnect = false;
                        }
                        this.emit("CLIENT_DISCONNECTED");
                        Model.reset();
                    });

                    // Connecting without logging in is the rarer case, so make the default to log in
                    if (doLogin) {
                        this.login();
                    }

                    // Also should make this an optional separate function too (maybe, maybe not)
                    this.keepAlive = setInterval(function () { this.TxCmd(FCTYPE.NULL, 0, 0, 0); }.bind(this), 120 * 1000);
                    this.emit("CLIENT_CONNECTED");
                    resolve();
                });
            });
        });
    }

    // Logs in to MFC.  This should only be called after Client connect(false);
    // See the comment on Client's constructor for details on the password to use.
    public login(username?: string, password?: string): void {
        if (username !== undefined) {
            this.username = username;
        }
        if (password !== undefined) {
            this.password = password;
        }
        this.TxCmd(FCTYPE.LOGIN, 0, 20071025, 0, this.username + ":" + this.password);
    }

    private hookModelsLoaded() {
        let completedModels = false;
        let completedFriends = true;
        function modelListFinished(packet: Packet) {
            // nTo of 2 means these are metrics for friends
            // nTo of 20 means these are metrics for online models in general
            // nTo of 64 means something else that I'm not sure about, maybe region hidden models?
            if (packet.nTo === 2) {
                if (packet.nArg1 !== packet.nArg2) {
                    completedFriends = false;
                } else {
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
    }

    // Connects to MFC and logs in, just like this.connect(true),
    // but in this version the callback is not invoked immediately
    // on socket connection, but instead when the initial list of
    // online models has been fully populated.
    // If you're logged in as a user with friended models, this will
    // also wait until your friends list is completely loaded.
    // @TODO - Check if anything else is needed to wait for 'bookmarked'
    // models...
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
    public disconnect(): void {
        if (this.client !== undefined) {
            this.manualDisconnect = true;
            this.client.end();
            this.client = undefined;
        }
    }
}
applyMixins(Client, [EventEmitter]);

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

exports.Client = Client;
