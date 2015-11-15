/* jshint node: true, nonstandard: true, esversion: 6, indent: 4, undef: true, unused: true, bitwise: true, eqeqeq: true, latedef: true, trailing: true */
/*
packetInspector.js

Used for dumping raw packets to the console to learn about the MFC protocol and debug changes in their code
*/
"use strict";

let mfc = require('../../lib/MFCAuto.js');
let log = mfc.log;
let client = new mfc.Client();

client.on("ANY", function(packet){
    log(packet.toString(), "packetLog");
});

client.connectAndWaitForModels(function(){
    //@TODO - Find the most popular room and join it now
});
