exports.leaderboard = require('./src/social/leaderboards').leaderboard;
exports.submitScore = require('./src/social/leaderboards').submitScore;
exports.ping = require('./src/social/leaderboards').ping;
exports.echo = require('./src/social/leaderboards').echo;
exports.echoBack = require('./src/social/leaderboards').echoBack;
exports.orphanFunction = require('./src/social/leaderboards').orphanFunction;

const quizModule = require('./src/games/quiz');
exports.getQuizData = quizModule.getQuizData;
exports.saveQuiz = quizModule.saveQuiz;
exports.ingestBoxOfficeData = quizModule.ingestBoxOfficeData;
exports.replaceBoxOfficeData = quizModule.replaceBoxOfficeData;

const anagramModule = require('./src/anagrams');
exports.generateAnagramsBatch = anagramModule.generateAnagramsBatch;

const profilesModule = require('./src/social/profiles');
exports.getProfile = profilesModule.getProfile;
exports.updateProfile = profilesModule.updateProfile;
exports.publicFeed = profilesModule.publicFeed;
exports.feedAlias = profilesModule.feedAlias;
// Index-level rename: the handler file declares updateProfile, but this app
// exposes it under a different name at the index barrel. sourceExportName
// (updateProfile) must be what auth detection reads the handler file with,
// not route.name (renamedProfileCheck) — see auth.test.mjs.
exports.renamedProfileCheck = profilesModule.updateProfile;

const screeningsModule = require('./src/events/screenings');
exports.screeningsFeed = screeningsModule.screeningsFeed;
exports.screeningDetails = screeningsModule.screeningDetails;
exports.bookScreening = screeningsModule.bookScreening;

const moderationModule = require('./src/moderation');
exports.runBatchJob = moderationModule.runBatchJob;
