const { verifyAuthToken } = require('../../utils/helpers');

exports.leaderboard = async (req, res) => {
  if (req.method === 'GET') {
    res.json({ ok: true });
  }
};

exports.submitScore = async (req, res) => {
  const user = await verifyAuthToken(req);
  res.json({ user });
};

exports.orphanFunction = async (req, res) => res.json({});
