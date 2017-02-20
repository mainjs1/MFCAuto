# MFCAuto API Reference
## Client class

### constructor(username: string = "guest", password: string = "guest")
Creates a Client instance with the given credentials, or with guest credentials by default.  [See my comment here if you wish to log in with a real account.](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Client.ts#L23)

You can have multiple Client instances active and connected at once. They will not interfere with each other.

```javascript
var guestClient = new mfc.Client();
var premiumClient = new mfc.Client(premiumUsername, premiumPasswordHash);
```
Before any MFCAuto events are processed, either on the Client instances or Model instances, you must connect to MFC...

---

### connect(doLogin: boolean = true): Promise
Connects to MFC, optionally logs in, and returns a Promise that resolves as soon as the socket connection to an MFC chat server has been established
```javascript
//Most common case is simply to connect, log in, and start processing events
client.connect();
```

---

### connectAndWaitForModels(): void
Connects to MFC, logs in, and returns a Promise that resolves only when details for all online models have been received.

```javascript
client.connectAndWaitForModels().then(() => {
    //Do interesting stuff that depends on having models loaded here
});
```
This method always logs in, because MFC servers won't send information for all online models until you've logged as at least a guest.

---

### disconnect(): void
Disconnects a connected client. If the connected socket was the only thing keeping the NodeJS event loop alive, this will have the side-effect of ending the program.

---

### on(event: string, listener: (packet: Packet) => void): void
Every time MFCAuto receives a complete packet from the server, two events are emitted.  One named "ANY" and another named after the FCTYPE of the received packet.

[See Constants.ts for all possible FCTYPEs.](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L199) There are many, and I won't claim to know what they all mean.

```javascript
//Log all received packets
client.on("ANY", (packet) => {
    console.log(packet.toString());
});

//Do something with just SESSIONSTATE packets
client.on("SESSIONSTATE", (packet) => {
    //Do something here...
});
```

---

### TxCmd(nType: FCTYPE, nTo: number = 0, nArg1: number = 0, nArg2: number = 0, sMsg: string = null): void
Sends a command to the MFC chat server. In practice, I rarely use this directly and have only scratched the surface of what commands are valid.  You probably don't need to use this for anything frankly.  Instead, the following methods are useful wrappers that abstract the common commands.

---

### joinRoom(id: number): void
Joins the given model's chat room. This is required to start receiving her room chat. This call can fail if you're banned from the model's room. There is no built-in way to detect such a failures. Trial and error has shown me that you'll receive an FCTYPE.BROADCASTPROFILE packet when you attempt to enter a room you're banned from.  You can set up a separate listener for such a packet and handle the error yourself.

---

### leaveRoom(id: number): void
Leave the given model's chat room.

---

### sendChat(id: number, msg: string): void
Sends "msg" to a model's chat room.  Call this only after joining the room.  This message could fail to be sent if you're muted or banned. At present, no easy way to detect failure is provided.

---

### sendPM(id: number, msg: string): void
Sends "msg" to a model (or any user by ID) via PM.  This message could fail to be sent. At present, no easy way to detect failure is provided.

---

### queryUser(user: string | number): Promise
Looks up a user by username or id number and resolves with details for that user, or undefined if the user does not exist on MFC. If the user is a model, this will also have the side effect of updating her MFCAuto state before the promise is resolved.

Because this method supports querying for normal users as well as models, it does not resolve with a Model instance, but rather a [Message](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/sMessages.ts#L50) instead. If you were querying a model, that message can be converted to her full instance as seen below. If you were querying a member, note that the Message object has a .vs property which will tell that user's current state exactly like a model.bestSession.vs property would.

A user does not have to be online to be queried.

```javascript
// Query a user, which happens to be a model, by name
client.queryUser("AspenRae").then((msg) => {
    if (msg === undefined) {
        console.log("AspenRae probably temporarily changed her name");
    } else {
        //Get the full Model instance for her
        let AspenRae = mfc.Model.getModel(msg.uid);
        //Do stuff here...
    }
});

// Query a user by ID number
client.queryUser(3111899).then((msg) => {
    console.log(JSON.stringify(msg));
    //Will print something like:
    //  {"sid":0,"uid":3111899,"nm":"AspenRae","lv":4,"vs":127}
});

// Query a member by name and check their status
client.queryUser("MyPremiumMemberFriend").then((msg) => {
    if (msg) {
        if (msg.vs !== mfc.STATE.Offline) {
            console.log("My friend is online!");
        } else {
            console.log("My friend is offline");
        }
    } else {
        console.log("My friend no longer exists by that name");
    }
});

// Force update a model's status, without caring about the result here
// Potentially useful when your logic is in model state change handlers
client.queryUser(3111899);
```

---

## Model class

### static getModel(id: number): Model
Retrieves the Model instance matching a specific model ID.  Never create a model instance directly, use this method instead.

ID should be a valid model ID.  How can you determine a model's ID number?  The [first example here](https://github.com/ZombieAlex/MFCAuto/blob/master/README.md) has one way, using MFCAuto and the USERNAMELOOKUP command.  Another, simpler, way is to open a model's chat room as a "Popup" and look at the URL of that room.  In the URL, there will be a portion that says "broadcaster_id=3111899".  That number is that model's ID.

This method can be called to get a model's instance at any time, even before connecting a Client.  That is useful for adding event listeners to a specific model before starting Client processing.  That way you won't miss any state changes for the model.

```javascript
var AspenRae = mfc.Model.getModel(3111899);
```

---

### static findModels(filter: (model: Model) => boolean): Model[]
Retrieves all model instances matching a given filter.  You might, for instance, want to get all the models over 30 years old.  You could do that like this:

```javascript
var overThirtyModels = mfc.Model.findModels((m) => m.bestSession.age > 30);
```
For this method to return a useful list of matching models, you must have at least one connected Client.

---

### get bestSession(): ModelSessionDetails
The Model instance property ".bestSession" is an object that contains all of the interesting model properties like her age, room topic, online/offline status etc.  See below for a nearly complete list of what might be on .bestSession.

---

### static on(event: string, listener: (model: Model, before: any, after: any) => void): void
When any properties on the model's .bestSession object change, an event will be fired which is named after the altered property.  The callback will be given the model instance that fired the event, the value of the property before it changed, and the value of the property after it changed.

All properties of a model start as undefined and will fire at least one change event when MFC first tells us about the model.  For instance, age doesn't change frequently, but adding a listener for age can still be useful if you want to do something for all models of a certain age as soon as they come online.

This static method listens for changes on all models.  See below for a nearly complete list of event names.

```javascript
//Log a message any time any model goes into a group show
mfc.Model.on("vs", (model, before, after) => {
    if (after === mfc.STATE.GroupShow) {
        console.log(model.nm + " is now in a group show!");
    }
    //As a point of understanding, this statement will always be true here
    assert(model.bestSession.vs === after);
});
```

---

### on(event: string, listener: (model: Model, before: any, after: any) => void): void
Invoke the listener when a property changes for just this one model.

```javascript
//Log whenever AspenRae appears to be running a raffle
var AspenRae = mfc.Model.getModel(3111899);
AspenRae.on("topic", (model, before, after) => {
    if(/raffle/i.test(after)){
        console.log("AspenRae seems to be running a raffle! '" + after + "'");
    }
    //As a point of understanding, this statement will always be true here
    assert(model.bestSession.topic === after);
});
```
See below for a nearly complete list of event names.

---

## static when(condition: whenFilter, onTrue: whenCallback, onFalseAfterTrue: whenCallback = null): void
On every change for any model, the given condition callback will be invoked. If condition returns true, the onTrue callback will be invoked with the instance of the model that matched the condition.  When that model stops matching the given condition, the onFalseAfterTrue callback will be invoked, if it was provided.

```javascript
mfc.Model.when(
    (m) => m.bestSession.rc > 2000,
    (m) => console.log(`${m.nm} has over 2000 viewers!`),
    (m) => console.log(`${m.nm} no longer has over 2000 viewers`)
);
```

---

## when(condition: whenFilter, onTrue: whenCallback, onFalseAfterTrue: whenCallback = null): void
On every change for this model, the given condition callback will be invoked. If condition returns true, the onTrue callback will be invoked with the instance of the model that matched the condition.  When that model stops matching the given condition, the onFalseAfterTrue callback will be invoked, if it was provided.

```javascript
var AspenRae = mfc.Model.getModel(3111899);
AspenRae.when(
    (m) => m.bestSession.vs !== mfc.STATE.Offline,
    (m) => console.log('AspenRae has logged on!'),
    (m) => console.log('AspenRae has logged off')
);
```

---

### Model "bestSession" properties and event names
Here are most of the possible events to listen for and properties to look for on .bestSession.  This is not a complete set because MFC can change their protocol to add a new property and MFCAuto will start merging that into .bestSession and firing events for it immediately, without me having to notice or document it.

Most of these properties are optional, and might be undefined for any given model.

|Property and event name|Which is short for...|Description|Before/After Argument Type|
|---|---|---|---|
|uid|user id|The model's user ID|number
|nm|name|The model's current name|string
|sid|session id|The model's MFC session ID|number
|vs|video state|The general status of a model (online, offline, away, freechat, private, or groupshow). There are many other status possibilities, but those are the ones you likely care about.|[FCVIDEO](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L312) or the more friendly form, [STATE](https://github.com/ZombieAlex/MFCAuto/blob/master/src/main/Constants.ts#L8)
|truepvt|true private|If a model is in vs STATE.Private and this value is 1, then that private is a true private. There is no unique state for true private, you have to check both vs and truepvt values.|number (0 or 1)
|tags| |The model's self-created tags. This property is on the model instance directly, not .bestSession.|Array&lt;string&gt;
|camscore| |The model's current camscore|number
|hidecs| |If true, the model is hiding her camscore on the website (.bestSession.camscore will still have her camscore)|boolean
|continent| |Two letter continent abbreviation such as "EU", "SA", "NA" etc for the model's current IP address based on geo-location data. Note that many models use VPNs so their IP geolocation may not accurately reflect their real world location|string
|kbit|kilobits|This used to contain the upstream bandwidth of the model, but is now always 0|number
|lastnews| |The timestamp of the model's last newsfeed entry|number
|missmfc| |A number indicating whether a model has been in the top 3 of Miss MFC before or not|number
|new_model| |1 if this model is considered "new" and 0 if she isn't|number
|rank| |The model's current Miss MFC rank for this month, or 0 if the model is ranked greater than 1000|number
|rc|room count|The number of people in the model's room|number
|topic| |The model's current room topic|string
|age| |Model's age, if she specified one|number
|creation| |Timestamp of the model's account creation|string
|blurb| |The model's bio blurb which shows at the top of their profile and directly under their name in the user menu|string
|ethnic| |Model's user provided ethnicity|string
|occupation| |Model's user provided occupation|string
|photos| |A count of the number of photos on the model's profile|number
|guests_muted| |0 if guests are not muted in the model's room, 1 if they are|number
|basics_muted| |0 if basics are not muted in the model's room, 1 if they are|number
|model_sw| |1 if the model is logged in via the model software, 0 if they are using the website instead|number
