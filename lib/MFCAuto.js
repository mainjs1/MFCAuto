var EventEmitter = require('events').EventEmitter;
var assert = require("assert");
//Creates and maintains a TCP socket connection to MFC chat servers similar to
//the way the Flash client connects and communicates with MFC.
var Client = (function () {
    //By default, this client will log in as a guest.
    //
    //To log in with a real account you specify your username as normal text.
    //The password should be a hash of your real password and NOT your actual
    //plain text password.  I have not determined how the passwords are hashed
    //but you can discover the appropriate string to use by checking your browser
    //cookies after logging in via your browser.  In Firefox, go to Options->Privacy
    //and then "Show Cookies..." and search for "myfreecams".  You will see one
    //cookie named "passcode".  Select it and copy the value listed as "Content".
    //It will be a long string of lower case letters that looks like gibberish.
    //*That* is the password to use here.
    function Client(username, password) {
        if (username === void 0) { username = "guest"; }
        if (password === void 0) { password = "guest"; }
        this.debug = false; //Set to true to enable debug logging
        this.net = require('net');
        this.username = username;
        this.password = password;
        this.sessionId = 0;
        this.streamBuffer = new Buffer(0);
        this.streamBufferPosition = 0;
    }
    //Simple helper log function that adds a timestamp and supports filtering 'debug' only messages
    Client.prototype.log = function (msg, debugOnly) {
        if (debugOnly === void 0) { debugOnly = false; }
        if (debugOnly && !this.debug) {
            return;
        }
        log(msg);
    };
    /*Reads data from the socket as quickly as possible and stores it in an internal buffer
    readData is invoked by the "on data" event of the net.client object currently handling
    the TCP connection to the MFC servers.

    This is an internal method, don't call it directly.*/
    Client.prototype._readData = function (buf) {
        this.streamBuffer = Buffer.concat([this.streamBuffer, buf]);
        //The new buffer might contain a complete packet, try to read to find out...
        this._readPacket();
    };
    /*Called with a single, complete, packet.  This function processes the packet,
    handling some special packets like FCTYPE_LOGIN, which gives our user name and
    session ID when first logging in to mfc.  It then calls out to any registered
    event handlers.

    This is an internal method, don't call it directly.*/
    Client.prototype._packetReceived = function (packet) {
        this.log(packet.toString(), true);
        //Special case some packets to update and maintain internal state
        switch (packet.FCType) {
            case FCTYPE.LOGIN:
                //Store username and session id returned by the login response packet
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
                //According to the site code, these packets can all trigger a user state update
                //Except in these specific cases...
                if ((packet.FCType === FCTYPE.DETAILS && packet.nFrom === FCTYPE.TOKENINC) ||
                    (packet.FCType === FCTYPE.ROOMHELPER && packet.nArg2 < 100) ||
                    (packet.FCType === FCTYPE.JOINCHAN && packet.nArg2 === FCCHAN.PART)) {
                    break;
                }
                //Ok, we're good, merge if there's anything to merge
                if (packet.sMessage !== undefined) {
                    var lv = (packet.sMessage).lv;
                    var uid = (packet.sMessage).uid;
                    if (uid === undefined) {
                        uid = packet.aboutModel.uid;
                    }
                    //Only merge models (when we can tell). Unfortunately not every SESSIONSTATE
                    //packet has a user level property. So this is no worse than we had been doing
                    //before in terms of merging non-models...
                    if (uid !== undefined && (lv === undefined || lv === 4)) {
                        Model.getModel(uid).mergePacket(packet);
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
                //@TODO - @BUGBUG - this can also trigger a model state update...
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
                // log(packet.toString());
                // assert.fail("@TODO - We're not merging in bookmarks packets yet unfortunately...");
                // process.exit(1);
                break;
        }
        //Fire this packet's event for any listeners
        this.emit(FCTYPE[packet.FCType], packet);
        this.emit(FCTYPE[FCTYPE.ANY], packet);
    };
    /*Parses the MFC stream buffer, for each complete individual packet
    it receives, it will call packetReceived.  Because of the single-threaded async nature of node.js, there will often be
    partial packets and need to handle that gracefully, only calling packetReceived once
    we've parsed out a complete response...

    This is an internal method, don't call it directly.*/
    Client.prototype._readPacket = function () {
        var pos = this.streamBufferPosition;
        var intParams = [];
        var strParam;
        try {
            //Each incoming packet is initially tagged with 7 int32 values, they look like this:
            // 0 = "Magic" value that is *always* -2027771214
            // 1 = "FCType" that identifies the type of packet this is (FCType being a MyFreeCams defined thing)
            // 2 = nFrom
            // 3 = nTo
            // 4 = nArg1
            // 5 = nArg2
            // 6 = sPayload, the size of the payload
            // 7 = sMessage, the actual payload.  This is not an int but is the actual buffer
            //Any read here could throw a RangeError exception for reading beyond the end of the buffer.  In theory we could handle this
            //better by checking the length before each read, but that would be a bit ugly.  Instead we handle the RangeErrors and just
            //try to read again the next time the buffer grows and we have more data
            //Parse out the first 7 integer parameters (Magic, FCType, nFrom, nTo, nArg1, nArg2, sPayload)
            for (var i = 0; i < 7; i++) {
                intParams.push(this.streamBuffer.readInt32BE(pos));
                pos += 4;
            }
            //If the first integer is MAGIC, we have a valid packet
            if (intParams[0] === MAGIC) {
                //If there is a JSON payload to this packet
                if (intParams[6] > 0) {
                    //If we don't have the complete payload in the buffer already, bail out and retry after we get more data from the network
                    if (pos + intParams[6] > this.streamBuffer.length) {
                        throw new RangeError(); //This is needed because streamBuffer.toString will not throw a rangeerror when the last param is out of the end of the buffer
                    }
                    //We have the full packet, store it and move our buffer pointer to the next packet
                    strParam = this.streamBuffer.toString('utf8', pos, pos + intParams[6]);
                    pos = pos + intParams[6];
                }
            }
            else {
                //Magic value did not match?  In that case, all bets are off.  We no longer understand the MFC stream and cannot recover...
                //This is usually caused by a mis-alignment error due to incorrect buffer management (bugs in this code or the code that writes the buffer from the network)
                throw new Error("Invalid packet received! - " + intParams[0] + " Length == " + this.streamBuffer.length);
            }
            //At this point we have the full packet in the intParams and strParam values, but intParams is an unstructured array
            //Let's clean it up before we delegate to this.packetReceived.  (Leaving off the magic int, because it MUST be there always
            //and doesn't add anything to the understanding)
            var strParam2;
            if (strParam) {
                try {
                    strParam2 = JSON.parse(strParam);
                }
                catch (e) {
                    strParam2 = strParam;
                }
            }
            this._packetReceived(new Packet(this, //Packet needs to look up certain values in the Client object instance
            intParams[1], //FCType
            intParams[2], //nFrom
            intParams[3], //nTo
            intParams[4], //nArg1
            intParams[5], //nArg2
            intParams[6], //sPayload
            strParam2 //sMessage
            ));
            //If there's more to read, keep reading (which would be the case if the network sent >1 complete packet in a single transmission)
            if (pos < this.streamBuffer.length) {
                this.streamBufferPosition = pos;
                this._readPacket();
            }
            else {
                //We read the full buffer, clear the buffer cache so that we can
                //read cleanly from the beginning next time (and save memory)
                this.streamBuffer = new Buffer(0);
                this.streamBufferPosition = 0;
            }
        }
        catch (e) {
            //RangeErrors are expected because sometimes the buffer isn't complete.  Other errors are not...
            if (e.toString().indexOf("RangeError") !== 0) {
                throw e;
            }
            else {
            }
        }
    };
    //Takes an input chat string as you would type it in browser in an MFC
    //chat room, like "I am happy :mhappy", and formats the message as MFC
    //would internally before sending it to the server, "I am happy #~ue,2c9d2da6.gif,mhappy~#"
    //in the given example.
    //
    //On the MFC site, this code is part of the ParseEmoteInput function in
    //http://www.myfreecams.com/_js/mfccore.js, and it is especially convoluted
    //code involving ajax requests back to the server depending on the text you're
    //sending and a giant hashtable of known emotes.
    //
    //Note that if the text you want to send does not have any emotes, you can
    //directly use TxCmd with the raw string (or possibly the escape(string) but
    //that's easy enough)
    Client.prototype.EncodeRawChat = function (rawMsg, callback) {
        if (rawMsg.match(/^ *$/)) {
            callback(rawMsg, null);
            return;
        }
        rawMsg = rawMsg.replace(/`/g, "'");
        rawMsg = rawMsg.replace(/<~/g, "'");
        rawMsg = rawMsg.replace(/~>/g, "'");
        this.ensureEmoteParserIsLoaded(function (msg, cb) {
            this.emoteParser.Process(msg, cb);
        }.bind(this, rawMsg, callback));
    };
    //Dynamically loads script code from MFC, massaging it with the given massager
    //function first, and then passes the resulting instantiated object to the
    //given callback.
    //
    //We try to use this sparingly as it opens us up to breaks from site changes.
    //But it is still useful for the more complex or frequently updated parts
    //of MFC.
    Client.prototype.loadFromMFC = function (url, callback, massager) {
        var http = require('http');
        var load = require('load');
        http.get(url, function (res) {
            var contents = '';
            res.on('data', function (chunk) {
                contents += chunk;
            });
            res.on('end', function () {
                try {
                    if (massager !== undefined) {
                        contents = massager(contents);
                    }
                    var mfcModule = load.compiler(contents);
                    callback(undefined, mfcModule);
                }
                catch (e) {
                    callback(e, undefined);
                }
            });
        }).on('error', function (e) {
            throw new Error("loadFromMFC error while loading '" + url + "' : " + e);
        });
    };
    //Loads the emote parsing code from the MFC web site directly, if it's not
    //already loaded, and then invokes the given callback.  This is useful because
    //most scripts won't actually need the emote parsing capabilities, so lazy
    //loading it can speed up the common case.
    //
    //We're loading this code from the live site instead of re-coding it ourselves
    //here because of the complexity of the code and the fact that it has changed
    //several times in the past.
    Client.prototype.ensureEmoteParserIsLoaded = function (callback) {
        if (this.emoteParser !== undefined) {
            callback();
        }
        else {
            this.loadFromMFC("http://www.myfreecams.com/_js/mfccore.js", function (err, obj) {
                if (err)
                    throw err;
                this.emoteParser = new obj.ParseEmoteInput();
                this.emoteParser.setUrl("http://www.myfreecams.com/mfc2/php/ParseChatStream.php");
                callback();
            }.bind(this), function (content) {
                //Massager....Yes this is vulnerable to site breaks, but then
                //so is this entire module.
                //First, pull out only the ParseEmoteInput function
                var startIndex = content.indexOf("function ParseEmoteInput()");
                var endIndex = content.indexOf("function ParseEmoteOutput()");
                assert.ok(startIndex !== -1 && endIndex !== -1 && startIndex < endIndex, "mfccore.js layout has changed, don't know what to do now");
                content = content.substr(startIndex, endIndex - startIndex);
                //Then massage the function somewhat and prepend some prerequisites
                content = "var document = {cookie: ''};var XMLHttpRequest = require('XMLHttpRequest').XMLHttpRequest;function bind(that,f){return f.bind(that);}" + content.replace(/createRequestObject\(\)/g, "new XMLHttpRequest()").replace(/new MfcImageHost\(\)/g, "{host: function(){return '';}}").replace(/this\.Reset\(\);/g, "this.Reset();this.oReq = new XMLHttpRequest();");
                return content;
            });
        }
    };
    //Loads the lastest server information from MFC, if it's not already loaded
    Client.prototype.ensureServerConfigIsLoaded = function (callback) {
        if (this.serverConfig !== undefined) {
            callback();
        }
        else {
            this.loadFromMFC("http://www.myfreecams.com/_js/serverconfig.js", function (err, obj) {
                if (err)
                    throw err;
                this.serverConfig = obj.serverConfig;
                callback();
            }.bind(this), function (text) {
                return "var serverConfig = " + text;
            });
        }
    };
    //Sends a message back to MFC in the expected packet format
    //usually nTo==0, nArg1==0, nArg2==0, sMsg==null
    //@TODO - Should this use the Packet class instead or as an overload?
    Client.prototype.TxCmd = function (nType, nTo, nArg1, nArg2, sMsg) {
        if (nTo === void 0) { nTo = 0; }
        if (nArg1 === void 0) { nArg1 = 0; }
        if (nArg2 === void 0) { nArg2 = 0; }
        if (sMsg === void 0) { sMsg = null; }
        this.log("TxCmd Sending - nType: " + nType + ", nTo: " + nTo + ", nArg1: " + nArg1 + ", nArg2: " + nArg2 + ", sMsg:" + sMsg, true);
        if (nType === FCTYPE.CMESG || nType === FCTYPE.PMESG) {
            if (sMsg.match(/([\u0000-\u001f\u0022-\u0026\u0080-\uffff]+)/))
                sMsg = escape(sMsg).replace(/%20/g, " ");
        }
        var msgLength = (sMsg ? sMsg.length : 0);
        var buf = new Buffer((7 * 4) + msgLength);
        buf.writeInt32BE(MAGIC, 0);
        buf.writeInt32BE(nType, 4);
        buf.writeInt32BE(this.sessionId, 8); //Session id, this is always our nFrom value
        buf.writeInt32BE(nTo, 12);
        buf.writeInt32BE(nArg1, 16);
        buf.writeInt32BE(nArg2, 20);
        buf.writeInt32BE(msgLength, 24);
        if (sMsg) {
            buf.write(sMsg, 28);
        }
        this.client.write(buf);
    };
    //Takes a number that might be a user id or a room
    //id and converts it to a user id (if necessary)
    Client.toUserId = function (id) {
        if (id > 100000000) {
            id = id - 100000000;
        }
        return id;
    };
    //Takes a number that might be a user id or a room
    //id and converts it to a room id (if necessary)
    Client.toRoomId = function (id) {
        if (id < 100000000) {
            id = id + 100000000;
        }
        return id;
    };
    //Send msg to the given model's chat room.  Set format to true
    //if this message contains any emotes.  Otherwise, you can save
    //considerable processing time by leaving it false and sending the
    //raw string.
    //
    //Note that you must have previously joined the model's chat room
    //for the message to be sent successfully.
    //
    //Also note, this method has no callback currently, and your message
    //may fail to be sent successfully if you are muted or ignored by
    //the model.
    Client.prototype.sendChat = function (id, msg, format) {
        if (format === void 0) { format = false; }
        if (format === true) {
            this.EncodeRawChat(msg, function (parsedMsg) {
                this.sendChat(id, parsedMsg, false);
            }.bind(this));
        }
        else {
            id = Client.toRoomId(id);
            this.TxCmd(FCTYPE.CMESG, id, 0, 0, msg);
        }
    };
    //Send msg to the given model via PM.  Set format to true
    //if this message contains any emotes.  Otherwise, you can save
    //considerable processing time by leaving it false and sending the
    //raw string.
    //
    //Also note, this method has no callback currently, and your message
    //may fail to be sent successfully if you are ignored by the model or
    //do not have PM access (due to being a guest, etc).
    Client.prototype.sendPM = function (id, msg, format) {
        if (format === void 0) { format = false; }
        if (format === true) {
            this.EncodeRawChat(msg, function (parsedMsg) {
                this.sendPM(id, parsedMsg, false);
            }.bind(this));
        }
        else {
            id = Client.toUserId(id);
            this.TxCmd(FCTYPE.PMESG, id, 0, 0, msg);
        }
    };
    //Joins the chat room of the given model
    Client.prototype.joinRoom = function (id) {
        id = Client.toRoomId(id);
        this.TxCmd(FCTYPE.JOINCHAN, 0, id, FCCHAN.JOIN);
    };
    //Leaves the chat room of the given model
    Client.prototype.leaveRoom = function (id) {
        id = Client.toRoomId(id);
        this.TxCmd(FCTYPE.JOINCHAN, 0, id, FCCHAN.PART); //@TODO - Confirm that this works, it's not been tested
    };
    //Connects to MFC and optionally logs in with the credentials you supplied when
    //constructing this Client.
    //
    //Logging in is optional because not all queries to the server require you to log in.
    //For instance, MFC servers will respond to a USERNAMELOOKUP request without
    //requiring a login.
    Client.prototype.connect = function (doLogin, onConnect) {
        if (doLogin === void 0) { doLogin = true; }
        if (onConnect === void 0) { onConnect = undefined; }
        //Reset any read buffers so we are in a consistent state
        this.streamBuffer = new Buffer(0);
        this.streamBufferPosition = 0;
        this.ensureServerConfigIsLoaded(function () {
            var chatServer = this.serverConfig.chat_servers[Math.floor(Math.random() * this.serverConfig.chat_servers.length)];
            this.log("Connecting to MyFreeCams chat server " + chatServer + "...");
            this.client = this.net.connect(8100, chatServer + ".myfreecams.com", function () {
                this.client.on('data', function (data) {
                    this._readData(data);
                }.bind(this));
                this.client.on('end', function () {
                    this.log('Disconnected from MyFreeCams.  Reconnecting in 30 seconds...'); // Is 30 seconds reasonable?
                    if (this.password === "guest" && this.username.startsWith("Guest")) {
                        //If we had a successful guest login before, we'll have changed
                        //username to something like Guest12345 or whatever the server assigned
                        //to us. That is not valid to log in again, so reset it back to guest.
                        this.username = "guest";
                    }
                    clearInterval(this.keepAlive);
                    setTimeout(this.connect.bind(this), 30000);
                }.bind(this));
                //Connecting without logging in is the rarer case, so make the default to log in
                if (doLogin) {
                    this.login();
                }
                //Also should make this an optional separate function too (maybe, maybe not)
                this.keepAlive = setInterval(function () { this.TxCmd(FCTYPE.NULL, 0, 0, 0, null); }.bind(this), 120 * 1000);
                if (onConnect !== undefined) {
                    onConnect();
                }
            }.bind(this));
        }.bind(this));
    };
    //@TODO - Do we need a logout method?
    //Logs in to MFC.  This should only be called after Client connect(false);
    //See the comment on Client's constructor for details on the password to use.
    Client.prototype.login = function (username, password) {
        if (username !== undefined) {
            this.username = username;
        }
        if (password !== undefined) {
            this.password = password;
        }
        this.TxCmd(FCTYPE.LOGIN, 0, 20071025, 0, this.username + ":" + this.password);
    };
    //Connects to MFC and logs in, just like this.connect(true),
    //but in this version the callback is not invoked immediately
    //on socket connection, but instead when the initial list of
    //online models has been fully populated.
    //If you're logged in as a user with friended models, this will
    //also wait until your friends list is completely loaded.
    //@TODO - Check if anything else is needed to wait for 'bookmarked'
    //models...
    Client.prototype.connectAndWaitForModels = function (onConnect) {
        var completedModels = false;
        var completedFriends = true;
        function modelListFinished(packet) {
            //nTo of 2 means these are metrics for friends
            //nTo of 20 means these are metrics for online models in general
            //nTo of 64 means something else that I'm not sure about, maybe region hidden models?
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
                onConnect();
            }
        }
        this.on("METRICS", modelListFinished.bind(this));
        this.connect(true);
    };
    return Client;
})();
applyMixins(Client, [EventEmitter]);
exports.Client = Client;

//Various constants and enums used by MFC.  Most of these values can be seen here:
//http://www.myfreecams.com/_js/mfccore.js
var MAGIC = -2027771214;
//STATE is essentially the same as FCVIDEO but has friendly names
//for better log messages and code readability
var STATE;
(function (STATE) {
    STATE[STATE["FreeChat"] = 0] = "FreeChat";
    //TX_RESET = 1,         //Unused?
    STATE[STATE["Away"] = 2] = "Away";
    //TX_CONFIRMING = 11,   //Unused?
    STATE[STATE["Private"] = 12] = "Private";
    STATE[STATE["GroupShow"] = 13] = "GroupShow";
    //TX_RESERVED = 14,     //Unused?
    //TX_KILLMODEL = 15,    //Unused?
    //C2C_ON = 20,          //Unused?
    //C2C_OFF = 21,         //Unused?
    STATE[STATE["Online"] = 90] = "Online";
    //RX_PVT = 91,          //Unused?
    //RX_VOY = 92,          //Unused?
    //RX_GRP = 93,          //Unused?
    //NULL = 126,           //Unused?
    STATE[STATE["Offline"] = 127] = "Offline"; //OFFLINE
})(STATE || (STATE = {}));
;
var FCTYPE;
(function (FCTYPE) {
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
    FCTYPE[FCTYPE["BROADCASTPROFILE"] = 11] = "BROADCASTPROFILE";
    FCTYPE[FCTYPE["BROADCASTNEWS"] = 12] = "BROADCASTNEWS";
    FCTYPE[FCTYPE["ANNOUNCE"] = 13] = "ANNOUNCE";
    FCTYPE[FCTYPE["MANAGELIST"] = 14] = "MANAGELIST";
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
    FCTYPE[FCTYPE["QUIETCHAN"] = 55] = "QUIETCHAN";
    FCTYPE[FCTYPE["BANCHAN"] = 56] = "BANCHAN";
    FCTYPE[FCTYPE["PREVIEWCHAN"] = 57] = "PREVIEWCHAN";
    FCTYPE[FCTYPE["SHUTDOWN"] = 58] = "SHUTDOWN";
    FCTYPE[FCTYPE["LISTBANS"] = 59] = "LISTBANS";
    FCTYPE[FCTYPE["UNBAN"] = 60] = "UNBAN";
    FCTYPE[FCTYPE["SETWELCOME"] = 61] = "SETWELCOME";
    FCTYPE[FCTYPE["PERMABAN"] = 62] = "PERMABAN";
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
    FCTYPE[FCTYPE["DISCONNECTED"] = 98] = "DISCONNECTED";
    FCTYPE[FCTYPE["LOGOUT"] = 99] = "LOGOUT";
})(FCTYPE || (FCTYPE = {}));
;
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
;
var FCLEVEL;
(function (FCLEVEL) {
    FCLEVEL[FCLEVEL["INVALID"] = -1] = "INVALID";
    FCLEVEL[FCLEVEL["GUEST"] = 0] = "GUEST";
    FCLEVEL[FCLEVEL["BASIC"] = 1] = "BASIC";
    FCLEVEL[FCLEVEL["PREMIUM"] = 2] = "PREMIUM";
    FCLEVEL[FCLEVEL["MODEL"] = 4] = "MODEL";
    FCLEVEL[FCLEVEL["ADMIN"] = 5] = "ADMIN";
})(FCLEVEL || (FCLEVEL = {}));
;
var FCCHAN;
(function (FCCHAN) {
    FCCHAN[FCCHAN["NOOPT"] = 0] = "NOOPT";
    FCCHAN[FCCHAN["JOIN"] = 1] = "JOIN";
    FCCHAN[FCCHAN["PART"] = 2] = "PART";
    FCCHAN[FCCHAN["OLDMSG"] = 4] = "OLDMSG";
    FCCHAN[FCCHAN["HISTORY"] = 8] = "HISTORY";
    FCCHAN[FCCHAN["LIST"] = 16] = "LIST";
    FCCHAN[FCCHAN["WELCOME"] = 32] = "WELCOME";
    FCCHAN[FCCHAN["BATCHPART"] = 64] = "BATCHPART";
    FCCHAN[FCCHAN["EXT_USERNAME"] = 128] = "EXT_USERNAME";
    FCCHAN[FCCHAN["EXT_USERDATA"] = 256] = "EXT_USERDATA";
    FCCHAN[FCCHAN["ERR_NOCHANNEL"] = 2] = "ERR_NOCHANNEL";
    FCCHAN[FCCHAN["ERR_NOTMEMBER"] = 3] = "ERR_NOTMEMBER";
    FCCHAN[FCCHAN["ERR_GUESTMUTE"] = 4] = "ERR_GUESTMUTE";
    FCCHAN[FCCHAN["ERR_GROUPMUTE"] = 5] = "ERR_GROUPMUTE";
    FCCHAN[FCCHAN["ERR_NOTALLOWED"] = 6] = "ERR_NOTALLOWED";
    FCCHAN[FCCHAN["ERR_CONTENT"] = 7] = "ERR_CONTENT";
})(FCCHAN || (FCCHAN = {}));
;
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
;
var FCACCEPT;
(function (FCACCEPT) {
    FCACCEPT[FCACCEPT["NOBODY"] = 0] = "NOBODY";
    FCACCEPT[FCACCEPT["FRIENDS"] = 1] = "FRIENDS";
    FCACCEPT[FCACCEPT["ALL"] = 2] = "ALL";
})(FCACCEPT || (FCACCEPT = {}));
;
var FCACCEPT_V2;
(function (FCACCEPT_V2) {
    FCACCEPT_V2[FCACCEPT_V2["NONE"] = 8] = "NONE";
    FCACCEPT_V2[FCACCEPT_V2["FRIENDS"] = 16] = "FRIENDS";
    FCACCEPT_V2[FCACCEPT_V2["MODELS"] = 32] = "MODELS";
    FCACCEPT_V2[FCACCEPT_V2["PREMIUMS"] = 64] = "PREMIUMS";
    FCACCEPT_V2[FCACCEPT_V2["BASICS"] = 128] = "BASICS";
    FCACCEPT_V2[FCACCEPT_V2["ALL"] = 240] = "ALL";
})(FCACCEPT_V2 || (FCACCEPT_V2 = {}));
;
var FCNOSESS;
(function (FCNOSESS) {
    FCNOSESS[FCNOSESS["NONE"] = 0] = "NONE";
    FCNOSESS[FCNOSESS["PVT"] = 1] = "PVT";
    FCNOSESS[FCNOSESS["GRP"] = 2] = "GRP";
})(FCNOSESS || (FCNOSESS = {}));
;
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
;
var FCUCR;
(function (FCUCR) {
    FCUCR[FCUCR["VM_LOUNGE"] = 0] = "VM_LOUNGE";
    FCUCR[FCUCR["VM_MYWEBCAM"] = 1] = "VM_MYWEBCAM";
    FCUCR[FCUCR["CREATOR"] = 0] = "CREATOR";
    FCUCR[FCUCR["FRIENDS"] = 1] = "FRIENDS";
    FCUCR[FCUCR["MODELS"] = 2] = "MODELS";
    FCUCR[FCUCR["PREMIUMS"] = 4] = "PREMIUMS";
    FCUCR[FCUCR["BASICS"] = 8] = "BASICS";
    FCUCR[FCUCR["ALL"] = 15] = "ALL";
})(FCUCR || (FCUCR = {}));
;
var FCUPDATE;
(function (FCUPDATE) {
    FCUPDATE[FCUPDATE["NONE"] = 0] = "NONE";
    FCUPDATE[FCUPDATE["MISSMFC"] = 1] = "MISSMFC";
    FCUPDATE[FCUPDATE["NEWTIP"] = 2] = "NEWTIP";
})(FCUPDATE || (FCUPDATE = {}));
;
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
    FCOPT[FCOPT["BOOKMARK"] = 16384] = "BOOKMARK";
})(FCOPT || (FCOPT = {}));
;
var FCBAN;
(function (FCBAN) {
    FCBAN[FCBAN["NONE"] = 0] = "NONE";
    FCBAN[FCBAN["TEMP"] = 1] = "TEMP";
    FCBAN[FCBAN["SIXTYDAY"] = 2] = "SIXTYDAY";
    FCBAN[FCBAN["LIFE"] = 3] = "LIFE";
})(FCBAN || (FCBAN = {}));
;
var FCNEWSOPT;
(function (FCNEWSOPT) {
    FCNEWSOPT[FCNEWSOPT["NONE"] = 0] = "NONE";
    FCNEWSOPT[FCNEWSOPT["IN_CHAN"] = 1] = "IN_CHAN";
    FCNEWSOPT[FCNEWSOPT["IN_PM"] = 2] = "IN_PM";
    FCNEWSOPT[FCNEWSOPT["AUTOFRIENDS_OFF"] = 4] = "AUTOFRIENDS_OFF";
    FCNEWSOPT[FCNEWSOPT["IN_CHAN_NOPVT"] = 8] = "IN_CHAN_NOPVT";
    FCNEWSOPT[FCNEWSOPT["IN_CHAN_NOGRP"] = 16] = "IN_CHAN_NOGRP";
})(FCNEWSOPT || (FCNEWSOPT = {}));
;
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
;
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
    FCVIDEO[FCVIDEO["OFFLINE"] = 127] = "OFFLINE";
})(FCVIDEO || (FCVIDEO = {}));
;
var MYWEBCAM;
(function (MYWEBCAM) {
    MYWEBCAM[MYWEBCAM["EVERYONE"] = 0] = "EVERYONE";
    MYWEBCAM[MYWEBCAM["ONLYUSERS"] = 1] = "ONLYUSERS";
    MYWEBCAM[MYWEBCAM["ONLYFRIENDS"] = 2] = "ONLYFRIENDS";
    MYWEBCAM[MYWEBCAM["ONLYMODELS"] = 3] = "ONLYMODELS";
    MYWEBCAM[MYWEBCAM["FRIENDSANDMODELS"] = 4] = "FRIENDSANDMODELS";
    MYWEBCAM[MYWEBCAM["WHITELIST"] = 5] = "WHITELIST";
})(MYWEBCAM || (MYWEBCAM = {}));
;
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
;
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
    TKOPT[TKOPT["HDVIDEO"] = 1048576] = "HDVIDEO";
})(TKOPT || (TKOPT = {}));
;
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
;
exports.FCTYPE = FCTYPE;
exports.FCRESPONSE = FCRESPONSE;
exports.FCLEVEL = FCLEVEL;
exports.FCCHAN = FCCHAN;
exports.FCGROUP = FCGROUP;
exports.FCACCEPT = FCACCEPT;
exports.FCACCEPT_V2 = FCACCEPT_V2;
exports.FCNOSESS = FCNOSESS;
exports.FCMODEL = FCMODEL;
exports.FCUCR = FCUCR;
exports.FCUPDATE = FCUPDATE;
exports.FCOPT = FCOPT;
exports.FCBAN = FCBAN;
exports.FCNEWSOPT = FCNEWSOPT;
exports.FCSERV = FCSERV;
exports.FCVIDEO = FCVIDEO;
exports.MYWEBCAM = MYWEBCAM;
exports.EVSESSION = EVSESSION;
exports.TKOPT = TKOPT;
exports.FCWOPT = FCWOPT;
exports.STATE = STATE;

var EventEmitter = require('events').EventEmitter;
//Model represents a single MFC model, or technically any MFC user whether or
//not that user is a model, admin, guest, basic, premium user, etc.
//
//The Model constructor also serves as a static dictionary of all known models
//which can be accessed via Model.getModel().
//
//Finally, Model emits events when the Model's state is changed.  This is best
//explained via examples.  So see the readme.md
var Model = (function () {
    //Constructs a new model with the given user id and, optionally, a
    //SESSIONSTATE or TAGS packet containing the initial model details.
    function Model(uid, packet) {
        this.tags = []; //Tags are not session specific
        //Models, and other members, can be logged on more than once. For example, in
        //multiple browsers, etc. In those cases, we'll be getting distinct FCVIDEO
        //state updates from each session. And it's not accurate to report only the
        //most recently seen video state. For example, a model might be in free chat
        //and open another browser window to check her email or current rank. Then
        //she closes the secondary browser window and we get a sessionstate updated
        //saying that second session is now Offline, but she never left cam in her
        //original session. It's incorrect to say she's offline now. So State is not
        //as simple as a single value, and we must track all known sessions for each
        //member.
        //
        //This is a map of SessionID->full state for that session, for all known
        //sessions known for this user.
        //
        //You should be using the .bestSession property to find the most correct
        //session for all-up status reporting.
        this.knownSessions = new Map();
        this.uid = uid;
        if (packet !== undefined) {
            this.client = packet.client;
            this.mergePacket(packet);
        }
    }
    //Retrieves a specific model instance by user id from knownModels, creating
    //the model instance if it does not already exist.
    Model.getModel = function (id) {
        if (typeof id === 'string')
            id = parseInt(id);
        Model.knownModels[id] = Model.knownModels[id] || (new Model(id));
        return Model.knownModels[id];
    };
    //Retrieves a list of models matching the given filter.
    Model.findModels = function (filter) {
        var models = [];
        for (var id in Model.knownModels) {
            if (Model.knownModels.hasOwnProperty(id)) {
                if (filter(Model.knownModels[id])) {
                    models.push(Model.knownModels[id]);
                }
            }
        }
        return models;
    };
    Object.defineProperty(Model.prototype, "bestSessionId", {
        //Similar to MfcSessionManager.prototype.determineBestSession
        //picks the most 'correct' session to use for reporting model status
        //Basically, if model software is being used, pick the session
        //with the highest sessionid among non-offline sessions where
        //model software is being used.  Otherwise, pick the session
        //with the highest sessionid among all non-offline sessions.
        //Otherwise, if all sessions are offline, return 0.
        get: function () {
            var sessionIdToUse = 0;
            var foundModelSoftware = false;
            this.knownSessions.forEach(function (sessionObj, sessionId) {
                if (sessionObj.vs === STATE.Offline) {
                    return; //Don't consider offline sessions
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
                session = { sid: 0, vs: STATE.Offline };
            }
            return session;
        },
        enumerable: true,
        configurable: true
    });
    //Merges a raw MFC packet into this model's state
    //
    //Also, there are a few bitmasks that are sent as part of the chat messages.
    //Just like StoreUserHash, we will decode those bitmasks here for convenience
    //as they contain useful information like if a private is true private or
    //if guests or basics are muted or if the model software is being used.
    Model.prototype.mergePacket = function (packet) {
        if (this.client === undefined && packet.client !== undefined) {
            this.client = packet.client;
        }
        //Find the session being updated by this packet
        var previousSession = this.bestSession;
        var currentSessionId;
        if (packet.FCType === FCTYPE.TAGS) {
            //Special case TAGS packets, because they don't contain a sessionID
            //So just fake that we're talking about the previously known best session
            currentSessionId = previousSession.sid;
        }
        else {
            currentSessionId = packet.sMessage.sid || 0;
        }
        if (!this.knownSessions.has(currentSessionId)) {
            this.knownSessions.set(currentSessionId, { sid: currentSessionId, vs: STATE.Offline });
        }
        var currentSession = this.knownSessions.get(currentSessionId);
        var callbackStack = [];
        //Merge the updates into the correct session
        switch (packet.FCType) {
            case FCTYPE.TAGS:
                var tagPayload = packet.sMessage;
                assert.notStrictEqual(tagPayload[this.uid], undefined, "This FCTYPE.TAGS messages doesn't appear to be about this model(" + this.uid + "): " + JSON.stringify(tagPayload));
                callbackStack.push({ prop: "tags", oldstate: this.tags, newstate: (this.tags = this.tags.concat(tagPayload[this.uid])) });
                //@TODO - Are tags incrementally added in updates or just given all at once in a single dump??  Not sure, for now
                //we're always adding to any existing tags.  Have to watch if this causes tag duplication or not
                break;
            default:
                //This must be typed as any in order to iterate over its keys in a for-in
                //It's real type is Message, but since my type definitions may be incomplete
                //and even if they are complete, MFC may add a new property, we need to
                //iterate over all the keys.
                var payload = packet.sMessage;
                assert.notStrictEqual(payload, undefined);
                assert.ok(payload.lv === undefined || payload.lv === 4, "Merging a non-model? Non-models need some special casing that is not currently implemented.");
                assert.ok(payload.uid === undefined || this.uid === payload.uid, "Merging a packet meant for a different model!: " + packet.toString());
                for (var key in payload) {
                    //Rip out the sMessage.u|m|s properties and put them on the session at
                    //the top level.  This allows for listening on simple event
                    //names like 'rank' or 'camscore'.
                    if (key === "u" || key === "m" || key === "s") {
                        for (var key2 in payload[key]) {
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
        //If our "best" session has changed to a new session, the above
        //will capture any changed or added properties, but not the removed
        //properties, so we'll add callbacks for removed properties here...
        if (currentSession.sid !== previousSession.sid) {
            Object.getOwnPropertyNames(previousSession).forEach(function (name) {
                if (!currentSession.hasOwnProperty(name)) {
                    callbackStack.push({ prop: name, oldstate: previousSession[name], newstate: undefined });
                }
            });
        }
        //If, after all the changes have been applied, this new session is our "best" session,
        //fire our change events.
        //
        //Otherwise, if this isn't the "best" session and one we should use for all-up reporting,
        //and they're not part of the "last" session (meaning after merging this packet from a real
        //session, if .bestSession is the fake sid===0 session, then this current session was the last
        //online session) then the changes aren't relevant and shouldn't be sent as notifications.
        if (this.bestSessionId === currentSession.sid || (this.bestSessionId === 0 && currentSession.sid !== 0)) {
            if (this.bestSession.nm !== this.nm && this.bestSession.nm !== undefined) {
                //Promote any name changes to a top level property on this
                //This is a mild concession to my .bestSession refactoring in
                //MFCAuto 2.0.0, which fixes the primary break in most of my
                //scripts.
                this.nm = this.bestSession.nm;
            }
            callbackStack.forEach((function (item) {
                //But only if the state has changed. Otherwise the event is not really
                //very useful, and, worse, it's very noisy in situations where you have
                //multiple connected Client objects all updating the one true model
                //registry with duplicated SESSIONSTATE events
                if (item.oldstate !== item.newstate) {
                    this.emit(item.prop, this, item.oldstate, item.newstate);
                    Model.emit(item.prop, this, item.oldstate, item.newstate);
                }
            }).bind(this));
        }
        this.purgeOldSessions();
    };
    //Don't store sessions forever, older offline sessions will never
    //be our "best" session and we won't use it for anything
    Model.prototype.purgeOldSessions = function () {
        var sids = Array.from(this.knownSessions.keys); //Session IDs will be in insertion order, first seen to latest (if the implementation follows the ECMAScript spec)
        var that = this;
        sids.forEach(function (sid) {
            if (that.knownSessions.get(sid).vs === undefined || that.knownSessions.get(sid).vs === FCVIDEO.OFFLINE) {
                that.knownSessions.delete(sid);
            }
        });
    };
    Model.prototype.toString = function () {
        function censor(key, value) {
            if (key === "client") {
                //This would lead to a circular reference
                return undefined;
            }
            return value;
        }
        return JSON.stringify(this, censor);
    };
    //EventEmitter object to be used for events firing for all models
    Model.EventsForAllModels = new EventEmitter();
    //Expose the "all model" events as constructor properies to be accessed
    //like Model.on(...)
    Model.addListener = Model.EventsForAllModels.addListener;
    Model.on = Model.EventsForAllModels.on;
    Model.once = Model.EventsForAllModels.once;
    Model.removeListener = Model.EventsForAllModels.removeListener;
    Model.removeAllListeners = Model.EventsForAllModels.removeAllListeners;
    Model.getMaxListeners = Model.EventsForAllModels.getMaxListeners;
    Model.setMaxListeners = Model.EventsForAllModels.setMaxListeners;
    Model.listeners = Model.EventsForAllModels.listeners;
    Model.emit = Model.EventsForAllModels.emit;
    Model.listenerCount = Model.EventsForAllModels.listenerCount;
    //A registry of all known models that is built up as we receive
    //model information from the server.  This should not be accessed
    //directly.  Use the Model.getModel() method instead.
    Model.knownModels = {};
    return Model;
})();
;
applyMixins(Model, [EventEmitter]);
exports.Model = Model;

//Packet represents a single, complete message received from the chat server
var Packet = (function () {
    function Packet(client, FCType, nFrom, nTo, nArg1, nArg2, sPayload, sMessage) {
        this.client = client; //@TODO - Break this circular reference, for now it's used in .aboutModel
        this.FCType = FCType;
        this.nFrom = nFrom;
        this.nTo = nTo;
        this.nArg1 = nArg1;
        this.nArg2 = nArg2;
        this.sPayload = sPayload;
        this.sMessage = sMessage;
    }
    Object.defineProperty(Packet.prototype, "aboutModel", {
        //Try to determine which model this packet is loosely "about"
        //meaning whose receiving the tip/chat/status update/etc
        get: function () {
            //This whole method is black magic that may or may not be correct :)
            if (this._aboutModel === undefined) {
                var id = -1;
                if (this.nTo !== this.client.sessionId) {
                    id = this.nTo;
                }
                else {
                    if (this.nArg2 > 1000) {
                        id = this.nArg2;
                    }
                    else {
                        if (this.nArg1 > 1000) {
                            id = this.nArg1;
                        }
                    }
                }
                id = Client.toUserId(id);
                this._aboutModel = Model.getModel(id);
            }
            return this._aboutModel;
        },
        enumerable: true,
        configurable: true
    });
    //This parses MFC's emote encoding and replaces those tokens with the simple
    //emote code like ":wave".  Design intent is not for this function to be
    //called directly, but rather for the decoded string to be accessed through
    //the pMessage property, which has the beneficial side-effect of caching the
    //result for faster repeated access.
    Packet.prototype._parseEmotes = function (msg) {
        try {
            msg = unescape(msg);
            // image parsing
            var nParseLimit = 0;
            // This regex is directly from mfccore.js, ParseEmoteOutput.prototype.Parse, with the same variable name etc
            var oImgRegExPattern = /#~(e|c|u|ue),(\w+)(\.?)(jpeg|jpg|gif|png)?,([\w\-\:\);\(\]\=\$\?\*]{0,48}),?(\d*),?(\d*)~#/;
            var re = [];
            while ((re = msg.match(oImgRegExPattern)) && nParseLimit < 10) {
                var sShortcut = re[5] || '';
                if (sShortcut) {
                    sShortcut = ':' + sShortcut;
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
            //In practice I've never seen this happen, but if it does, it's not serious enough to tear down the whole client...
            log("Error parsing emotes from '" + msg + "': " + e);
            return undefined;
        }
    };
    Object.defineProperty(Packet.prototype, "pMessage", {
        //Returns the formatted text of chat, PM, or tip messages.  For instance
        //the raw sMessage.msg string may be something like:
        //  "I am happy #~ue,2c9d2da6.gif,mhappy~#"
        //This returns that in the more human readable format:
        //  "I am happy :mhappy"
        get: function () {
            //Formats the parsed message component of this packet, if one exists, with decoded emotes
            if (this._pMessage === undefined && typeof this.sMessage === 'object') {
                if (this.FCType === FCTYPE.CMESG || this.FCType === FCTYPE.PMESG || this.FCType === FCTYPE.TOKENINC) {
                    var obj = (this.sMessage);
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
        //For chat, PM, or tip messages, this property returns the text of the
        //message as it would appear in the MFC chat window with the username
        //prepended, etc:
        //
        //  AspenRae: Thanks guys! :mhappy
        //
        //This is useful for logging.
        get: function () {
            if (this._chatString === undefined) {
                if (this.sMessage && typeof this.sMessage === 'object') {
                    switch (this.FCType) {
                        case FCTYPE.CMESG:
                        case FCTYPE.PMESG:
                            var msg = (this.sMessage);
                            this._chatString = msg.nm + ": " + this.pMessage;
                            break;
                        case FCTYPE.TOKENINC:
                            var tok = (this.sMessage);
                            this._chatString = tok.u[2] + " has tipped " + tok.m[2] + " " + tok.tokens + " tokens" + (this.pMessage ? (": '" + this.pMessage + "'") : ".");
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
    };
    return Packet;
})();
exports.Packet = Packet;

/*
The Packet class represents a complete message from the MFC chat server.  Many
of those messages will contain an sMessage JSON payload.  The types in this file
attempt to capture all the possible permutations of sMessages.

It's quite likely this is an incomplete list, and it's certain that my
understanding of MFC's messages is imperfect.  Neither of those facts impact
the functionality of MFCAuto.  This file acts mostly as a means of increasing
understanding of the MFC communication protocol.
*/

//Helper logging function that timestamps each message and optionally outputs to a file as well
function log(msg, fileRoot, consoleFormatter) {
    assert.notStrictEqual(msg, undefined, "Trying to print undefined.  This usually indicates a bug upstream from the log function.");
    //Pads single digit number with a leading zero, simple helper function for log2
    function toStr(n) { return n < 10 ? '0' + n : '' + n; }
    var fs = require("fs");
    var d = new Date();
    var taggedMsg = "[" + (toStr(d.getMonth() + 1)) + "/" + (toStr(d.getDate())) + "/" + (d.getFullYear()) + " - " + (toStr(d.getHours())) + ":" + (toStr(d.getMinutes())) + ":" + (toStr(d.getSeconds()));
    if (fileRoot !== undefined) {
        taggedMsg += (", " + fileRoot.toUpperCase() + "] " + msg);
    }
    else {
        taggedMsg += ("] " + msg);
    }
    if (consoleFormatter !== undefined) {
        if (consoleFormatter !== null) {
            console.log(consoleFormatter(taggedMsg));
        }
    }
    else {
        console.log(taggedMsg);
    }
    if (fileRoot !== undefined) {
        var fd = fs.openSync(fileRoot + ".txt", "a"); //@TODO - Could create separate logs per date, or could just slam everything into one file...not sure what's best, but one file is easiest for the moment
        fs.writeSync(fd, taggedMsg + "\r\n");
        fs.closeSync(fd);
    }
}
//Think of this as util.inherits, except that it doesn't completely overwrite
//the prototype of the base object.  It just adds to it.
function applyMixins(derivedCtor, baseCtors) {
    baseCtors.forEach(function (baseCtor) {
        Object.getOwnPropertyNames(baseCtor.prototype).forEach(function (name) {
            derivedCtor.prototype[name] = baseCtor.prototype[name];
        });
    });
}
exports.log = log;
