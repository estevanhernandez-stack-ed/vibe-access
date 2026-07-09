const { onRequest } = require("firebase-functions/v2/https");
const { verifyAuthToken } = require("../../utils/helpers");

// screeningsFeed: wrapper-call form (const x = onRequest(...)), name does NOT
// match the get/list/my/fetch/*Data read-name heuristic, guards with the
// positive form (req.method === "GET").
const screeningsFeed = onRequest({ cors: true }, async (req, res) => {
  if (req.method === "GET") {
    res.json({ screenings: [] });
  }
});

// screeningDetails: wrapper-call form guarding with the reject-others form
// (req.method !== "GET") — the phase-1d method-inference finding. Before the
// fix, inferMethod only recognized the positive `===` guard, so this route
// silently fell back to the POST default even though it's GET-only.
const screeningDetails = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "GET") {
    res.status(405).send("method not allowed");
    return;
  }
  res.json({ screening: null });
});

// bookScreening: wrapper-call form calling verifyAuthToken — the real-world
// idiom that e3d4609's fixture never exercised (const name = onRequest(...)
// rather than a bare function/arrow expression).
const bookScreening = onRequest({ cors: true }, async (req, res) => {
  const user = await verifyAuthToken(req);
  if (req.method !== "POST") {
    res.status(405).send("nope");
    return;
  }
  res.json({ user });
});

module.exports = { screeningsFeed, screeningDetails, bookScreening };
