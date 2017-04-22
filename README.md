# MFCAuto.js

A Node.js module for interacting with MyFreeCams servers. In a nutshell, this module allows a user to log on to MFC, listen for specific server events, and take action on those events.

Beyond exposing the communication protocol, MFCAuto.js provides several useful abstractions.  Notably, for the many tasks you may want to do based on changes in a model's status, MFCAuto.js provides plumbing which allows this to be trivial for client scripts.

While MFCAuto.js was developed entirely independently, at its core it is similar to [KradekMFC](https://github.com/KradekMFC)'s excellent [MFCSocket](https://github.com/KradekMFC/MFCSocket) module.

Here are some examples of how you might use MFCAuto.js.  [More complete API documentation can be found here](https://github.com/ZombieAlex/MFCAuto/tree/master/src/main) or by reviewing the source in the same folder directly.

------------

## Setup

```bash
# Install a released version using the release tag (recommended)
$ npm install ZombieAlex/MFCAuto#v3.4.5

# Install a specific commit hash (this is the v3.4.5 commit hash)
$ npm install ZombieAlex/MFCAuto#e1d4edc6018efbaf1eebee9f8aff8ec313988b98

# Install the latest MFCAuto from the tip of master
$ npm install ZombieAlex/MFCAuto
```

------------

## Examples

### Query MFC for a model's details
Here we query MFC for details about a specific model, AspenRae in this case, listen for the response and print it out before exiting.

MFC sends several different types of messages.  The type of any particular message is identifiable by a flag on the message that MFC refers to as its FCTYPE.  To see all possible FCTYPEs, check out the full FCTYPE enum in src/main/Constants.ts.

MFCAuto Client instances emit an event every time a message is received, using the FCTYPE of the message as the event name.

In this case, we're sending a request to the server via Client.txCmd() and know that the response to this request will be an FCTYPE.USERNAMELOOKUP message.

```javascript
var mfc = require("MFCAuto");
var client = new mfc.Client();

client.on("USERNAMELOOKUP", function(packet){
    console.log(packet.toString());
    client.disconnect();
});

client.connect(false).then(function(){
    client.TxCmd(mfc.FCTYPE.USERNAMELOOKUP, 0, 20, 0, 'AspenRae');
});
```

Note: As of MFCAuto 3.1.0, there is cleaner way to accomplish the same thing as the above:

```javascript
var mfc = require("MFCAuto");
var client = new mfc.Client();

client.connect(false)
    .then(() => client.queryUser("AspenRae"))
    .then((msg) => {
        console.log(JSON.stringify(msg));
        client.disconnect();
    });
```

---

### Log all chat in a room
Here we log into MFC as a guest and wait for a specific model to come online.  Then we join her room and begin logging all the room chat to the console.

This example introduces the Model object.  In addition to exposing the raw server messages to any event listeners you might register, MFCAuto.Client also processes the server messages itself to maintain and track the global state of all online Models.

As each Model's status is updated, the Model instance fires an event named after the property which was updated.  The event is given a reference to the Model that was changed, the value of the property before it was changed, and the newly applied value.

In this example, we are listening for changes in the Model's "vs" property, "vs" is short for "video state".  This field is what tracks the offline/on camera/away/in private/in group show status of each Model.  For all possible values of "video state" see the FCVIDEO enum in src/main/Constants.ts.

Note: If logging room chat or status changes is your primary scenario, you may want to check out my [MFCLogger](https://github.com/ZombieAlex/MFCLogger) module.

```javascript
var mfc = require("MFCAuto");
var client = new mfc.Client();
var modelId = 3111899; //AspenRae's model id which can be discovered by running the previous example among other means

//Wait for video state updates for a specific model
mfc.Model.getModel(modelId).on("vs", function(model,oldState,newState){
    if(newState !== mfc.FCVIDEO.OFFLINE) //When she's online
        client.joinRoom(modelId); //Join her room
});

//Listen for chat messages and print them
client.on("CMESG", function(packet){
    if(packet.chatString !== undefined){
        console.log(packet.chatString);
    }
});

//Listen for tip messages and print them
client.on("TOKENINC", function(packet){
    if(packet.chatString !== undefined){
        console.log(packet.chatString);
    }
});

//Connect to MFC and begin processing events
client.connect();
```

---

### Log when any model passes a viewer count of 1000
In the last example we listened for a state change on a specific model.  But we can also listen for state changes on *all* models by listening for the same kind of event on the Model constructor itself.

Here we listen for updates to the "rc" field of all models.  "rc" is short for "room count".

```javascript
var mfc = require("MFCAuto");
var client = new mfc.Client();

mfc.Model.on("rc",function(model, oldstate, newstate){
    if((oldstate === undefined || oldstate < 1000) && newstate >= 1000){
        console.log(model.nm + " has passed 1000 viewers!");
    }
});

client.connect();
```

---

### Log all messages received from the server to the console

This last example is quite similar to the first.  We'll connect to MFC as a guest, listen for any packet from the server, and print the contents of them all to the console.

Note that we're using the special event name, "ANY", which will be invoked on every message received from the server regardless of that message's actual FCTYPE.

Otherwise there are no new concepts here, but running this can be useful for understanding how MFC works and the kinds of data sent from the server, as well as the sheer volume of data.

```javascript
var mfc = require("MFCAuto");
var client = new mfc.Client();

client.on("ANY", function(packet){
    console.log(packet.toString());
});

client.connect();
```

-----------------------

