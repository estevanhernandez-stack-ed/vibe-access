exports.leaderboard = require('./src/social/leaderboards').leaderboard;
exports.submitScore = require('./src/social/leaderboards').submitScore;
exports.ping = require('./src/social/leaderboards').ping;
exports.echo = require('./src/social/leaderboards').echo;
exports.echoBack = require('./src/social/leaderboards').echoBack;
exports.orphanFunction = require('./src/social/leaderboards').orphanFunction;

const quizModule = require('./src/games/quiz');
exports.getQuizData = quizModule.getQuizData;
exports.saveQuiz = quizModule.saveQuiz;

const anagramModule = require('./src/anagrams');
exports.generateAnagramsBatch = anagramModule.generateAnagramsBatch;
