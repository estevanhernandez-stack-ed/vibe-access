exports.generateAnagramsBatch = (req, res) => {
  if (req.method === 'GET') {
    return res.status(400).json({ error: 'POST only' });
  }
  const words = req.body?.words || [];
  const result = words.map((w) => ({
    word: w,
    anagrams: generateAnagrams(w),
  }));
  res.json(result);
};

function generateAnagrams(word) {
  // Stub: real implementation would be in sibling files
  return [word.split('').reverse().join('')];
}
