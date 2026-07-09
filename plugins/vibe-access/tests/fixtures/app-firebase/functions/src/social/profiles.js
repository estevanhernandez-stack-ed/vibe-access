const { verifyAuthToken } = require('../../utils/helpers');
const auth = require('../../utils/admin');

async function getProfile(req, res) {
  const user = await verifyAuthToken(req);
  res.json({ user });
}

async function updateProfile(req, res) {
  const decoded = await auth.verifyIdToken(token);
  res.json({ ok: true });
}

function publicFeed(req, res) {
  if (req.method === 'GET') {
    res.json({ feed: [] });
  }
}

module.exports = { getProfile, updateProfile, publicFeed, feedAlias: publicFeed };
