const { Storage } = require(".");

var store = new Storage("test");

// store.read().then(() => {
//     console.log(store.get("hello"));
// });

store.set("hello", "world!");
store.flush();