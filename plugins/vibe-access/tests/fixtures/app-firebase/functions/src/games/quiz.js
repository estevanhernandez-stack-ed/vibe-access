exports.getQuizData = async (req, res) => {
  if (req.method === 'GET') {
    res.json({ ok: true });
  }
};

exports.saveQuiz = async (req, res) => res.json({ saved: true });
