var MFCAuto = require('./lib/MFCAuto');

for(var key in MFCAuto){
    if(MFCAuto.hasOwnProperty(key)){
        exports[key] = MFCAuto[key];
    }
}
