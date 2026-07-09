// Pure pass-through barrel — mirrors the real WeSeeYou app's
// functions/src/anagrams/index.js: this file does NOT define runBatchJob
// itself, it destructure-imports it from a sibling file and re-exports it
// unchanged. functions/index.js requires this directory ("./src/moderation"),
// which resolves to this index.js — the actual handler + auth check live one
// hop further, in ./worker.
const {runBatchJob} = require("./worker");

module.exports = {runBatchJob};
