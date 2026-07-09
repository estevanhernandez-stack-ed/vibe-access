"use strict";

// Sanitized structural copy of the real app's functions/src/anagrams/pipeline.js
// idiom: the auth check lives in its own standalone try/catch, preceding the
// main handler try/catch, rather than inside the same try block as the rest
// of the handler body.
const {onRequest} = require("firebase-functions/v2/https");
const {verifyAuthToken, checkAdminRole} = require("../utils/helpers");

const runBatchJob = onRequest(
    {cors: true, timeoutSeconds: 540, memory: "1GiB"},
    async (req, res) => {
      if (req.method !== "POST") {
        return res.status(405).json({error: "Method not allowed"});
      }

      try {
        const decoded = await verifyAuthToken(req);
        await checkAdminRole(decoded.uid);
      } catch (err) {
        return res.status(403).json({error: err.message});
      }

      try {
        res.status(200).json({ok: true});
      } catch (err) {
        res.status(500).json({error: err.message});
      }
    },
);

module.exports = {runBatchJob};
