/* jshint node: true, nonstandard: true, esversion: 6, indent: 4, undef: true, unused: true, bitwise: true, eqeqeq: true, latedef: true, trailing: true */
/* globals describe, it, before */

//@TODO - More response packet validation everywhere
"use strict";
let assert = require('assert');
let mfc = require('../../lib/MFCAuto.js');

describe('Startup Scenarios', function () {
    it("should be able to connect without logging in", function (done) {
        let client = new mfc.Client();
        client.connect(false, done);
    });
    it("should be able to log in as a guest", function (done) {
        let client = new mfc.Client();
        assert.strictEqual(client.username.indexOf('guest'), 0, "We didn't start in the default state?");
        client.on("LOGIN", function (packet) {
            assert.strictEqual(packet.nArg1, 0, "Failed login error code");
            assert.strictEqual(client.username.indexOf("Guest"), 0, "We didn't log in as a guest successfully");
            done();
        });
        client.connect(true);
    });
});

describe('Connected Scenarios', function () {
    this.timeout(7000);
    let client = new mfc.Client();
    before(function (done) {
        client.connectAndWaitForModels(done);
    });
    describe("Client", function () {
        it("should be able to send a USERNAMELOOKUP query and parse a valid response", function (done) {
            //Get all the models that are on cam
            let models = mfc.Model.findModels((m) => m.vs === 0);
            assert.notStrictEqual(models.length, 0, "No online models??  That's weird");
            
            //Pull out the first online model
            let model = models[0];
            assert.notStrictEqual(model.nm, undefined, "Models no longer have a name (nm) property?");

            //Register a handler for USERNAMELOOKUP messages
            function callback(packet) {
                //Check the contents, looking for known/unknown properties and validating the username //@TODO - @BUGBUG
                assert.strictEqual(packet.sMessage.nm, model.nm);
            
                //Remove this listener and complete the test
                client.removeListener("USERNAMELOOKUP", callback);
                done();
            }

            client.on("USERNAMELOOKUP", callback);

            //Query for her username
            client.TxCmd(mfc.FCTYPE.USERNAMELOOKUP, 0, 20, 0, model.nm);
        });

        it("should be able to join a room and log chat", function (done) {
            //Get all models with over 500 people in their room
            let popularModels = mfc.Model.findModels((m) => m.rc >= 500 && m.vs === 0);
            assert.notStrictEqual(popularModels.length, 0, "No models in public chat have more than 500 members in their rooms?");
           
            //Find the most popular model in free chat right now
            popularModels.sort(function (a, b) {
                if (a.rc > b.rc) {
                    return 1;
                }
                if (a.rc < b.rc) {
                    return -1;
                }
                return 0;
            });

            let queen = popularModels[popularModels.length - 1];

            client.on("CMESG", function (packet) {
                assert.strictEqual(packet.aboutModel.uid, queen.uid);
                if (packet.chatString !== undefined) {
                    client.leaveRoom(packet.aboutModel.uid);
                    client.removeAllListeners("CMESG");
                    done();
                }
            });
            
            client.joinRoom(queen.uid);
        });
    });
});
