exports.getQuizData = async (req, res) => {
  if (req.method === 'GET') {
    res.json({ ok: true });
  }
};

exports.saveQuiz = async (req, res) => res.json({ saved: true });

// ingestBoxOfficeData: name ends in "Data" (READ_NAME_RE's Data$ suffix would
// name-infer GET), but the body explicitly reject-guards on POST — the real
// WeSeeYouAtTheMovies dogfood finding (task-15-phase2-report.md). Body
// evidence must beat the name heuristic: this is POST-only, not GET.
exports.ingestBoxOfficeData = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('nope');
    return;
  }
  res.json({ ok: true });
};

// replaceBoxOfficeData: body positively guards a non-GET/POST method (PUT).
// Exercises the generalized per-method guard (both === and !== forms extend
// beyond GET/POST to PUT/PATCH/DELETE).
exports.replaceBoxOfficeData = async (req, res) => {
  if (req.method === 'PUT') {
    res.json({ replaced: true });
  }
};
