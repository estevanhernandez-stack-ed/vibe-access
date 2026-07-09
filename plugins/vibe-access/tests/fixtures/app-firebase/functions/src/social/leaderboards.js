const { verifyAuthToken } = require('../../utils/helpers');

exports.ping = async (req, res) => res.json({ pong: true });

exports.leaderboard = async (req, res) => {
  if (req.method === 'GET') {
    res.json({ ok: true });
  }
};

exports.submitScore = async (req, res) => {
  const user = await verifyAuthToken(req);
  res.json({ user });
};

exports.echoBack = async (req, res) => res.json({ echoed: true });

exports.echo = async (req, res) => {
  if (req.method === 'GET') {
    res.json({ ok: true });
  }
};

exports.orphanFunction = async (req, res) => res.json({});
