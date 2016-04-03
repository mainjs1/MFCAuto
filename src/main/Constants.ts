//Various constants and enums used by MFC.  Most of these values can be seen here:
//http://www.myfreecams.com/_js/mfccore.js

var MAGIC: number = -2027771214;

//STATE is essentially the same as FCVIDEO but has friendly names
//for better log messages and code readability
enum STATE {
    FreeChat = 0,           //TX_IDLE
    //TX_RESET = 1,         //Unused?
    Away = 2,               //TX_AWAY
    //TX_CONFIRMING = 11,   //Unused?
    Private = 12,           //TX_PVT
    GroupShow = 13,         //TX_GRP
    //TX_RESERVED = 14,     //Unused?
    //TX_KILLMODEL = 15,    //Unused?
    //C2C_ON = 20,          //Unused?
    //C2C_OFF = 21,         //Unused?
    Online = 90,            //RX_IDLE
    //RX_PVT = 91,          //Unused?
    //RX_VOY = 92,          //Unused?
    //RX_GRP = 93,          //Unused?
    //NULL = 126,           //Unused?
    Offline = 127           //OFFLINE
};

enum DISPLAY {
    'PM_INLINE_WHISPER' = 1,
    'PM_INLINE_ALL' = 2,
};

enum EVSESSION {
    'NONE' = 0,
    'PRIVATE' = 1,
    'VOYEUR' = 2,
    'GROUP' = 3,
    'FEATURE' = 4,
    'AWAYPVT' = 5,
    'TIP' = 10,
    'PUBLIC' = 100,
    'AWAY' = 101,
    'START' = 102,
    'UPDATE' = 103,
    'STOP' = 104,
};

enum FCACCEPT {
    'NOBODY' = 0,
    'FRIENDS' = 1,
    'ALL' = 2,
    'V2_NONE' = 8,
    'V2_FRIENDS' = 16,
    'V2_MODELS' = 32,
    'V2_PREMIUMS' = 64,
    'V2_BASICS' = 128,
    'V2_ALL' = 240,
};

enum FCBAN {
    'NONE' = 0,
    'TEMP' = 1,
    '60DAY' = 2,
    'LIFE' = 3,
};

enum FCCHAN {
    'NOOPT' = 0,
    'JOIN' = 1,
    'PART' = 2,
    'ERR_NOCHANNEL' = 2,
    'ERR_NOTMEMBER' = 3,
    'ERR_GUESTMUTE' = 4,
    'OLDMSG' = 4,
    'ERR_GROUPMUTE' = 5,
    'ERR_NOTALLOWED' = 6,
    'ERR_CONTENT' = 7,
    'HISTORY' = 8,
    'CAMSTATE' = 16,
    'LIST' = 16,
    'WELCOME' = 32,
    'BATCHPART' = 64,
    'EXT_USERNAME' = 128,
    'EXT_USERDATA' = 256,
};

enum FCERRTYPE {
    'INVALIDUSER' = 10,
    'NOACCESS' = 11,
    'NOSPACE' = 12,
};

enum FCGROUP {
    'NONE' = 0,
    'EXPIRED' = 1,
    'BUSY' = 2,
    'EMPTY' = 3,
    'DECLINED' = 4,
    'UNAVAILABLE' = 5,
    'SESSION' = 9,
};

enum FCLEVEL {
    'GUEST' = 0,
    'BASIC' = 1,
    'PREMIUM' = 2,
    'MODEL' = 4,
    'ADMIN' = 5,
};

enum FCMODE {
    'NOPM' = 0,
    'FRIENDPM' = 1,
    'ALLPM' = 2,
};

enum FCMODEL {
    'NONE' = 0,
    'NOGROUP' = 1,
    'FEATURE1' = 2,
    'FEATURE2' = 4,
    'FEATURE3' = 8,
    'FEATURE4' = 16,
    'FEATURE5' = 32,
};

enum FCNEWSOPT {
    'NONE' = 0,
    'IN_CHAN' = 1,
    'IN_PM' = 2,
    'AUTOFRIENDS_OFF' = 4,
    'ADDFRIENDS_OFF' = 4,
    'IN_CHAN_NOPVT' = 8,
    'IN_CHAN_NOGRP' = 16,
};

enum FCNOSESS {
    'NONE' = 0,
    'PVT' = 1,
    'GRP' = 2,
    'TRUEPVT' = 4,
    'TOKEN_MIN' = 8,
};

enum FCOPT {
    'NONE' = 0,
    'BOLD' = 1,
    'ITALICS' = 2,
    'REMOTEPVT' = 4,
    'TRUEPVT' = 8,
    'CAM2CAM' = 16,
    'RGNBLOCK' = 32,
    'TOKENAPPROX' = 64,
    'TOKENHIDE' = 128,
    'RPAPPROX' = 256,
    'RPHIDE' = 512,
    'HDVIDEO' = 1024,
    'MODELSW' = 2048,
    'GUESTMUTE' = 4096,
    'BASICMUTE' = 8192,
    'SMALLCAPS' = 16384,
    'BOOKMARK' = 16384,
};

enum FCRESPONSE {
    'SUCCESS' = 0,
    'ERROR' = 1,
    'NOTICE' = 2,
    'SUSPEND' = 3,
    'SHUTOFF' = 4,
    'WARNING' = 5,
    'QUEUED' = 6,
    'NO_RESULTS' = 7,
    'CACHED' = 8,
    'JSON' = 9,
    'INVALIDUSER' = 10,
    'NOACCESS' = 11,
    'NOSPACE' = 12,
};

enum FCSERV {
    'NONE' = 0,
    'VIDEO_CAM2CAM' = 1,
    'VIDEO_MODEL' = 2,
    'VIDEO_RESV2' = 4,
    'VIDEO_RESV3' = 8,
    'CHAT_MASTER' = 16,
    'CHAT_SLAVE' = 32,
    'CHAT_RESV2' = 64,
    'CHAT_RESV3' = 128,
    'AUTH' = 256,
    'AUTH_RESV1' = 512,
    'AUTH_RESV2' = 1024,
    'AUTH_RESV3' = 2048,
    'TRANS' = 4096,
    'TRANS_RESV1' = 8192,
    'TRANS_RESV2' = 16384,
    'TRANS_RESV3' = 32768,
};

enum FCTYPE {
    'ANY' = -2,
    'UNKNOWN' = -1,
    'NULL' = 0,
    'LOGIN' = 1,
    'ADDFRIEND' = 2,
    'PMESG' = 3,
    'STATUS' = 4,
    'DETAILS' = 5,
    'TOKENINC' = 6,
    'ADDIGNORE' = 7,
    'PRIVACY' = 8,
    'ADDFRIENDREQ' = 9,
    'USERNAMELOOKUP' = 10,
    'ZBAN' = 11,
    'BROADCASTPROFILE' = 11,
    'BROADCASTNEWS' = 12,
    'ANNOUNCE' = 13,
    'MANAGELIST' = 14,
    'MANAGELISTS' = 14,
    'INBOX' = 15,
    'GWCONNECT' = 16,
    'RELOADSETTINGS' = 17,
    'HIDEUSERS' = 18,
    'RULEVIOLATION' = 19,
    'SESSIONSTATE' = 20,
    'REQUESTPVT' = 21,
    'ACCEPTPVT' = 22,
    'REJECTPVT' = 23,
    'ENDSESSION' = 24,
    'TXPROFILE' = 25,
    'STARTVOYEUR' = 26,
    'SERVERREFRESH' = 27,
    'SETTING' = 28,
    'BWSTATS' = 29,
    'SETGUESTNAME' = 30,
    'SETTEXTOPT' = 31,
    'SERVERCONFIG' = 32,
    'MODELGROUP' = 33,
    'REQUESTGRP' = 34,
    'STATUSGRP' = 35,
    'GROUPCHAT' = 36,
    'CLOSEGRP' = 37,
    'UCR' = 38,
    'MYUCR' = 39,
    'SLAVECON' = 40,
    'SLAVECMD' = 41,
    'SLAVEFRIEND' = 42,
    'SLAVEVSHARE' = 43,
    'ROOMDATA' = 44,
    'NEWSITEM' = 45,
    'GUESTCOUNT' = 46,
    'PRELOGINQ' = 47,
    'MODELGROUPSZ' = 48,
    'ROOMHELPER' = 49,
    'CMESG' = 50,
    'JOINCHAN' = 51,
    'CREATECHAN' = 52,
    'INVITECHAN' = 53,
    'KICKCHAN' = 54,
    'QUIETCHAN' = 55,
    'BANCHAN' = 56,
    'PREVIEWCHAN' = 57,
    'SHUTDOWN' = 58,
    'LISTBANS' = 59,
    'UNBAN' = 60,
    'SETWELCOME' = 61,
    'PERMABAN' = 62,
    'CHANOP' = 62,
    'LISTCHAN' = 63,
    'TAGS' = 64,
    'SETPCODE' = 65,
    'SETMINTIP' = 66,
    'UEOPT' = 67,
    'HDVIDEO' = 68,
    'METRICS' = 69,
    'OFFERCAM' = 70,
    'REQUESTCAM' = 71,
    'MYWEBCAM' = 72,
    'MYCAMSTATE' = 73,
    'PMHISTORY' = 74,
    'CHATFLASH' = 75,
    'TRUEPVT' = 76,
    'BOOKMARKS' = 77,
    'EVENT' = 78,
    'STATEDUMP' = 79,
    'RECOMMEND' = 80,
    'EXTDATA' = 81,
    'ZGWINVALID' = 95,
    'CONNECTING' = 96,
    'CONNECTED' = 97,
    'DISCONNECTED' = 98,
    'LOGOUT' = 99,
};

enum FCUCR {
    'VM_LOUNGE' = 0,
    'CREATOR' = 0,
    'VM_MYWEBCAM' = 1,
    'FRIENDS' = 1,
    'MODELS' = 2,
    'PREMIUMS' = 4,
    'BASIC' = 8,
    'BASICS' = 8,
    'ALL' = 15,
};

enum FCUPDATE {
    'NONE' = 0,
    'MISSMFC' = 1,
    'NEWTIP' = 2,
};

enum FCVIDEO {
    'TX_IDLE' = 0,
    'TX_RESET' = 1,
    'TX_AWAY' = 2,
    'TX_CONFIRMING' = 11,
    'TX_PVT' = 12,
    'TX_GRP' = 13,
    'TX_RESERVED' = 14,
    'TX_KILLMODEL' = 15,
    'C2C_ON' = 20,
    'C2C_OFF' = 21,
    'RX_IDLE' = 90,
    'RX_PVT' = 91,
    'RX_VOY' = 92,
    'RX_GRP' = 93,
    'NULL' = 126,
    'UNKNOWN' = 127,
    'OFFLINE' = 127,
};

enum FCWINDOW {
    'NO_USER_PM' = 20,
    'OPTIONS_ADD_FRIEND' = 31,
    'OPTIONS_ADD_IGNORE' = 32,
};

enum FCWOPT {
    'NONE' = 0,
    'ADD' = 1,
    'REMOVE' = 2,
    'LIST' = 4,
    'NO_RECEIPT' = 128,
    'REDIS_JSON' = 256,
    'USERID' = 1024,
    'USERDATA' = 2048,
    'USERNAME' = 4096,
    'C_USERNAME' = 32768,
    'C_MONTHSLOGIN' = 65536,
    'C_LEVEL' = 131072,
    'C_VSTATE' = 262144,
    'C_CHATTEXT' = 524288,
    'C_PROFILE' = 1048576,
    'C_AVATAR' = 2097152,
    'C_RANK' = 4194304,
    'C_SDATE' = 8388608,
};

enum HIDE {
    'MODEL_GROUPS_AWAY' = 1,
    'MODEL_GROUPS_PRIVATE' = 2,
    'MODEL_GROUPS_GROUP' = 4,
    'MODEL_GROUPS_PUBLIC' = 8,
};

enum LOUNGE {
    'MASK_AUTO_CLICK' = 1,
    'MASK_NO_CAMSNAPS' = 2,
    'MASK_LOUNGE_MODE' = 4,
};

enum MODEL {
    'LIST_ICON_NEW_MODEL' = 1,
    'LIST_ICON_RECOMMEND' = 2,
    'LIST_ICON_POPULAR' = 4,
    'LIST_ICON_RECENT' = 8,
    'LIST_ICON_MISSMFC' = 16,
    'LIST_ICON_TRENDING' = 32,
};

enum MODELORDER {
    'NONE' = 0,
    'PVT' = 1,
    'TRUEPVT' = 2,
    'GRP' = 4,
};

enum MYFREECAMS {
    'NEWS_USER_ID' = 481462,
};

enum MYWEBCAM {
    'EVERYONE' = 0,
    'ONLYUSERS' = 1,
    'ONLYFRIENDS' = 2,
    'ONLYMODELS' = 3,
    'FRIENDSANDMODELS' = 4,
    'WHITELIST' = 5,
};

enum TKOPT {
    'NONE' = 0,
    'START' = 1,
    'STOP' = 2,
    'OPEN' = 4,
    'PVT' = 8,
    'VOY' = 16,
    'GRP' = 32,
    'TIP' = 256,
    'TIP_HIDDEN_AMT' = 512,
    'TIP_OFFLINE' = 1024,
    'TIP_MSG' = 2048,
    'TIP_ANON' = 4096,
    'TIP_PUBLIC' = 8192,
    'TIP_FROMROOM' = 16384,
    'TIP_PUBLICMSG' = 32768,
    'TIP_HISTORY' = 65536,
    'HDVIDEO' = 1048576,
};

enum USEREXT {
    'NUM' = 0,
    'STRING' = 1,
    'DATA' = 2,
    'STAMP' = 3,
};

enum WEBCAM {
    'SECURITY_EVERYONE' = 0,
    'SECURITY_FRIENDS' = 2,
    'SECURITY_MODELS' = 3,
    'SECURITY_MODELS_FRIENDS' = 4,
    'SECURITY_ALLOWED' = 5,
    'SECURITY_FRIEND_ID' = 100,
};

enum WINDOW {
    'MODE_DEFAULT' = 0,
    'MODE_DHTML' = 1,
    'MODE_DESKTOP_DHTML' = 1,
    'MODE_BROWSER' = 2,
    'MODE_MOBILE_DHTML' = 2,
};

exports.DISPLAY = DISPLAY;
exports.EVSESSION = EVSESSION;
exports.FCACCEPT = FCACCEPT;
exports.FCBAN = FCBAN;
exports.FCCHAN = FCCHAN;
exports.FCERRTYPE = FCERRTYPE;
exports.FCGROUP = FCGROUP;
exports.FCLEVEL = FCLEVEL;
exports.FCMODE = FCMODE;
exports.FCMODEL = FCMODEL;
exports.FCNEWSOPT = FCNEWSOPT;
exports.FCNOSESS = FCNOSESS;
exports.FCOPT = FCOPT;
exports.FCRESPONSE = FCRESPONSE;
exports.FCSERV = FCSERV;
exports.FCTYPE = FCTYPE;
exports.FCUCR = FCUCR;
exports.FCUPDATE = FCUPDATE;
exports.FCVIDEO = FCVIDEO;
exports.FCWINDOW = FCWINDOW;
exports.FCWOPT = FCWOPT;
exports.HIDE = HIDE;
exports.LOUNGE = LOUNGE;
exports.MODEL = MODEL;
exports.MODELORDER = MODELORDER;
exports.MYFREECAMS = MYFREECAMS;
exports.MYWEBCAM = MYWEBCAM;
exports.TKOPT = TKOPT;
exports.USEREXT = USEREXT;
exports.WEBCAM = WEBCAM;
exports.WINDOW = WINDOW;
exports.STATE = STATE;