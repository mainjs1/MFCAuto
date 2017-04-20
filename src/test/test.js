/* globals describe, it, before, after, afterEach */
// These tests can be run via `npm test` and a coverage report
// generated via istanbul with `npm run coverage`
"use strict";
let assert = require("assert");
let mfc = require("../../lib/index.js");

mfc.setLogLevel(mfc.LogLevel.SILENT);
// mfc.setLogLevel(mfc.LogLevel.DEBUG); // Uncomment for debug spew

function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

describe("Startup Scenarios", function () {
    this.timeout(9000);
    let client = null;
    afterEach((done) => {
        client.disconnect().then(() => {
            assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
            done();
        });
    });
    it("should be able to dynamically load the MFC server config", (done) => {
        client = new mfc.Client();
        client.ensureServerConfigIsLoaded().then(() => {
            assert.notStrictEqual(client.serverConfig, undefined);
            assert.notStrictEqual(client.serverConfig.chat_servers, undefined);
            assert.notStrictEqual(client.serverConfig.chat_servers.length, 0);
            done();
        });
    });
    it("should properly handle multiple manual client disconnects", () => {
        assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
        client.disconnect(() => {
            assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should still be 0 connected clients");
        });
        client.disconnect(() => {
            assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should really still be 0 connected clients");
        });
    });
    it("should be able to connect without logging in", (done) => {
        client = new mfc.Client();
        assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
        client.connect(false).then(() => {
            assert.strictEqual(mfc.Client.connectedClientCount, 0, "A client that's not logged in shouldn't count as connected");
            assert.strictEqual(client.choseToLogIn, false, "choseToLogin should be false");
            done();
        });
    });
    it("should be able to log in as a guest", (done) => {
        client = new mfc.Client();
        assert.strictEqual(client.username.indexOf("guest"), 0, "We didn't start in the default state?");
        assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
        client.on("LOGIN", (packet) => {
            assert.strictEqual(mfc.Client.connectedClientCount, 1, "Should be 1 connected clients now");
            assert.strictEqual(client.choseToLogIn, true, "choseToLogin should be true");
            assert.strictEqual(packet.nArg1, 0, "Failed login error code");
            assert.strictEqual(client.username.indexOf("Guest"), 0, "We didn't log in as a guest successfully");
            done();
        });
        client.connect(true);
    });
    it("should be able to log in as two guests", (done) => {
        client = new mfc.Client();
        let client2 = new mfc.Client();
        assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
        client.on("LOGIN", () => {
            assert.strictEqual(mfc.Client.connectedClientCount, 1, "Should be 1 connected client now");
            client2.connect(true);
        });
        client2.on("LOGIN", () => {
            assert.strictEqual(mfc.Client.connectedClientCount, 2, "Should be 2 connected clients now");
            client2.disconnect();
        });
        client2.on("CLIENT_DISCONNECTED", () => {
            assert.strictEqual(mfc.Client.connectedClientCount, 1, "Should be 1 connected client again");
            client.disconnect();
        });
        client.on("CLIENT_DISCONNECTED", () => {
            assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients again");
            done();
        });
        client.connect(true);
    });
    it("should handle TxCmd on a disconnected client gracefully", () => {
        try {
            client.joinRoom(3111899);
        } catch (e) {
            assert.strictEqual(e.toString(), "Error: Cannot call TxCmd on a disconnected client");
        }
    });
});

describe("Connected Scenarios", function () {
    this.timeout(9000);
    let client = new mfc.Client();
    let queen;
    before((done) => {
        assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
        client.connectAndWaitForModels().then(() => {
            //Find the most popular model in free chat right now
            let popularModels = mfc.Model.findModels((m) => m.bestSession.vs === 0);
            assert.notStrictEqual(popularModels.length, 0, "No models in public chat??? Is MFC down?");
            popularModels.sort((a, b) => a.bestSession.rc - b.bestSession.rc);
            queen = popularModels[popularModels.length - 1];
            done();
        });
    });
    after((done) => {
        client.disconnect().then(() => {
            assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
            done();
        });
    });
    describe("Client", () => {
        it("should be able to send a USERNAMELOOKUP query and parse a valid response", (done) => {
            assert.notStrictEqual(queen.bestSession.nm, undefined, "How do we not know the top model's name??");

            //Register a handler for USERNAMELOOKUP messages
            function callback(packet) {
                //Check the contents, looking for known/unknown properties and validating the username //@TODO - @BUGBUG
                assert.strictEqual(packet.sMessage.nm, queen.bestSession.nm);
                assert.strictEqual(queen.nm, queen.bestSession.nm);

                //Remove this listener and complete the test
                client.removeListener("USERNAMELOOKUP", callback);
                done();
            }

            client.on("USERNAMELOOKUP", callback);

            //Query for her username
            client.TxCmd(mfc.FCTYPE.USERNAMELOOKUP, 0, 20, 0, queen.bestSession.nm);
        });

        it("should be able to join a room and log chat", (done) => {
            client.on("CMESG", (packet) => {
                assert.strictEqual(packet.aboutModel.uid, queen.uid);
                if (packet.chatString !== undefined) {
                    //@TODO - Also ensure at least one of these
                    //messages has an emote to cover Packet._parseEmotes
                    //ideally we'd also check tips and tip messages but
                    //there is no guarantee we would see a tip before the timeout
                    client.leaveRoom(packet.aboutModel.uid);
                    client.removeAllListeners("CMESG");
                    done();
                }
            });

            client.joinRoom(queen.uid);
        });

        it("should be able to encode chat strings", (done) => {
            let decodedString = "I am happy :mhappy";
            client.EncodeRawChat(decodedString).then((parsedString/*, aMsg2*/) => {
                // assert.strictEqual(aMsg2.length, 2, "Unexpected number of emotes parsed");
                // assert.strictEqual(aMsg2[0], "I am happy ");
                // assert.strictEqual(aMsg2[1].txt, ":mhappy");
                // assert.strictEqual(aMsg2[1].url, "http://www.myfreecams.com/chat_images/u/2c/2c9d2da6.gif");
                // assert.strictEqual(aMsg2[1].code, "#~ue,2c9d2da6.gif,mhappy~#");
                assert.strictEqual(parsedString, "I am happy #~ue,2c9d2da6.gif,mhappy~#", `Encoding failed or returned an unexpected format: ${parsedString}`);

                //And we should be able to decode that string back too
                let packet = new mfc.Packet();
                assert.strictEqual(decodedString, packet._parseEmotes(parsedString), "Failed to decode the emote string");
                done();
            });
        });

        it("should be able to send chat", (done) => {
            /*
            @TODO - Find a room that allows guest chat, join it, send some text
            and validate that we receive the text back with a matching username, etc
            */
            //assert.fail("@TODO");
            done();
        });

        it("should be able to query users by name", (done) => {
            client.queryUser(queen.nm).then((response) => {
                assert.strictEqual(response.uid, queen.uid);
                done();
            });
        });

        it("should be able to query users by id", (done) => {
            client.queryUser(queen.uid).then((response) => {
                assert.strictEqual(response.nm, queen.nm);
                done();
            });
        });

        it("should gracefully handle a user query for a non-existent user name", (done) => {
            client.queryUser("RandomNameThatWouldNeverBeReal").then((response) => {
                assert.strictEqual(response, undefined);
                done();
            });
        });

        it("should gracefully handle a user query for a non-existent user id", (done) => {
            client.queryUser(1).then((response) => {
                assert.strictEqual(response, undefined);
                done();
            });
        });

        /*
        @TODO - More tests...
        Add a callback to the joinroom/sendChat/sendPM functions and ensure we
        get error messages for them when we're not allowed

        Generally change the callback formats to fit the expected patters of error first

        cover client.sendPM somehow (might need to log in for that unfortunately)

        maybe in before() here you set up an ANY handler that collects all seen FCTypes
        from the server and raises and then at the end we have one final test that confirms
        that we didn't see a new FCType?  Or we could do the same by getting mfccore.js from
        the server and iterating over all the FCTypes in it I guess.  The latter might be
        faster and more complete, assuming we know where to find the latest greated mfccore.js

        set up a gulp test task and integrate it with VS Code
        */
    });

    describe("Model", function () {
        this.timeout(60000);
        // it("should be able to listen for a specific model state change (this test frequently times out)", function(done) {
        //     mfc.Model.getModel(queen.uid).on("rc", function(model/*, oldstate, newstate*/) {
        //         assert.strictEqual(model.uid, queen.uid, "We got a callback for someone who isn't the top model?");
        //         mfc.Model.getModel(queen.uid).removeAllListeners("rc");
        //         done();
        //     });
        // });
        it("should be able to listen for global model state change events", (done) => {
            mfc.Model.on("rc", (model/*, oldstate, newstate*/) => {
                assert.notStrictEqual(model, undefined);
                mfc.Model.removeAllListeners("rc");
                done();
            });
        });
        it("should merge only models", () => {
            let nonModels = mfc.Model.findModels((m) => m.bestSession.sid !== 0 && m.bestSession.lv !== 4);
            assert.strictEqual(nonModels.length, 0);
        });
        it("should be able to process .when events on one model", (done) => {
            let filterMatched = false;
            queen.when(
                () => {
                    if (!filterMatched) {
                        filterMatched = true;
                        return true;
                    }
                    return false;
                },
                (m) => {
                    mfc.logWithLevel(mfc.LogLevel.DEBUG, `${m.nm} matched the filter`);
                    done();
                }//, Times out too often to wait for an exit
                // (m) => {
                //     mfc.logWithLevel(mfc.LogLevel.DEBUG, `${m.nm} stopped matching the filter`);
                //     done();
                // }
            );
        });
        it("should be able to process .when events on all models", (done) => {
            let matchedModels = new Set();
            let isDone = false;
            mfc.Model.when(
                (m) => m.bestSession.vs === mfc.STATE.Online,
                (m) => {
                    mfc.logWithLevel(mfc.LogLevel.DEBUG, `${m.nm} entered online`);
                    matchedModels.add(m.uid);
                },
                (m) => {
                    mfc.logWithLevel(mfc.LogLevel.DEBUG, `${m.nm} left online`);
                    assert.ok(matchedModels.has(m.uid), "We got an onFalseAfterTrue callback for a model that never matched the filter to begin with?");
                    if (!isDone) {
                        done();
                        isDone = true;
                    }
                }
            );
        });
    });
});

describe("Reconnect Scenarios", function () {
    this.timeout(30000);
    let client = null;
    afterEach((done) => {
        client.disconnect().then(() => {
            assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
            done();
        });
    });
    it("should recover from a socket disconnect", (done) => {
        let firstConnect = true;
        client = new mfc.Client();
        client.on("LOGIN", () => {
            if (firstConnect) {
                firstConnect = false;
                // Force disconnect after a random amount of time
                setTimeout(() => client.client.end(), randInt(50, 1500));
            } else {
                // We reconnected after the disconnect, good
                done();
            }
        });
        client.connect();
    });
    it("should stop trying recover from a socket disconnect if disconnect() is called", (done) => {
        client = new mfc.Client();
        client.on("LOGIN", () => {
            assert.strictEqual(mfc.Client.connectedClientCount, 1, "Should be 1 connected client now");
            assert.strictEqual(client.currentlyConnected, true, "Should be connected");
            setTimeout(() => client.client.end(), randInt(50, 1500));
        });
        client.on("CLIENT_DISCONNECTED", () => {
            assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
            assert.ok(client.reconnectTimer !== undefined, "Should be trying to reconnect now");
            client.disconnect().then(() => {
                assert.strictEqual(client.reconnectTimer, undefined, "Should no longer be trying to reconnect");
                assert.strictEqual(client.currentlyConnected, false, "Should not be connected");
                assert.strictEqual(mfc.Client.connectedClientCount, 0, "Should be 0 connected clients now");
                done();
            });
        });
        assert.strictEqual(client.reconnectTimer, undefined, "Should not be any reconnect timer yet");
        client.connect();
    });
});