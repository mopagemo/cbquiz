#!/usr/bin/env node

/* jshint esversion: 6 */

require('colors');
const argv = require('minimist')(process.argv.slice(2));
const fs = require('fs');
const readline = require('readline');

const logger = require('./src/logger');
const { loadQuestions, questions } = require('./src/questions');
const setupHTTP = require('./src/setupHTTP');
const setupTelnet = require('./src/setupTelnet');

const csvFilePath = argv._[0] || 'questions.csv';
if (!fs.existsSync(csvFilePath)) {
    logger.error(`
        CSV file with Questions was not found.
        Make sure it exists and you write it correctly, e.g.:
            ./quiz.js questions5.csv --port 9000
    `);
    process.exit();
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (input) => {
    processAdmin(input);
});

const httpPort = argv['http-port'] || 3300;
const httpHost = argv['http-host'] || `http${httpPort == 443 ? 's' : ''}://localhost${httpPort == 80 || httpPort == 443 ? '' : ':' + httpPort}`;

const telnetHost = argv['telnet-host'] || 'localhost';
const telnetPort = argv['telnet-port'] || 1337;

let httpHandicap = 0;
if(argv['http-handicap'] && typeof(argv['http-handicap']) == 'number') {
    httpHandicap = argv['http-handicap'] < 0 ? argv['http-handicap'] : argv['http-handicap'] * -1;
}

const game = {
    started: false,
    hangingRequests: [],
    questionCounter: -1,
    questionShowing: false,
    showStats,

    templateVars: {
        title: argv.title,
        httpHandicap: httpHandicap,
        httpHost: httpHost,
        httpPort: httpPort,
        telnetHost: telnetHost,
        telnetPort: telnetPort,
    }
};
const players = {};

let QUESTION_TIME = 15;
let questionTimer;

loadQuestions(csvFilePath);
logger.info(`Loaded questions from ${csvFilePath}`);

setupHTTP(httpPort, game, players);
setupTelnet(telnetPort, game, players);

logger.info(`HTTP handicap set to ${httpHandicap}`);

const QuizCommands = {
    Start: ['start'],
    Next: ['next', 'n'],
    SetTimeRegex: /^(?:t|time) ?(\d+)$/,
    SetQuestionRegex: /^q ?(\d+)$/,

    KickRegex: /^kick (.+) *$/,

    Stats: ['board', 'stats'],
    WebStats: ['webboard', 'webstats'],

    DebugOn: ['debug', 'debug on'],
    DebugOff: ['debug off'],
    DebugState: ['debug state'],
};

function processAdmin(input) {
    if (QuizCommands.Start.includes(input)) {
        game.questionCounter = 0;
        showQuestion(0);
        return;
    }

    if (QuizCommands.SetQuestionRegex.test(input)) {
        game.questionCounter = parseInt(RegExp.$1);
        showQuestion(game.questionCounter);
        return;
    }

    if (QuizCommands.Next.includes(input)) {
        game.questionCounter++;
        showQuestion(game.questionCounter);
        return;
    }

    if (QuizCommands.Stats.includes(input)) {
        showStats();
        return;
    }

    if (QuizCommands.WebStats.includes(input)) {
        showStats(true);
        return;
    }

    if (QuizCommands.SetTimeRegex.test(input)) {
        QUESTION_TIME = parseInt(RegExp.$1);
        logger.info('setting timeout to ' + QUESTION_TIME);
        return;
    }

    if (QuizCommands.KickRegex.test(input)) {
        kick(players, RegExp.$1);
        return;
    }

    if (QuizCommands.DebugOn.includes(input)) {
        logger.level = 'debug';
        logger.debug('debug enabled');
        return;
    }

    if (QuizCommands.DebugOff.includes(input)) {
        logger.level = 'info';
        logger.info('debug disabled');
        return;
    }

    if (QuizCommands.DebugState.includes(input)) {
        for (let playerId in players) {
            logger.info(
                `* ${playerId}: ${players[playerId].playerName} - ${players[playerId].telnet ? 'telnet' : 'web'}`
            );
        }
        return;
    }

    logger.error('eh?');
}

function showQuestion(questionIndex) {
    if (!questions[questionIndex]) {
        logger.error('invalid question ID');
        return;
    }

    logger.info(`Showing question ${questionIndex + 1} / ${questions.length}`);
    game.started = true;
    game.questionShowing = true;

    for (let playerAddress in players) {
        let player = players[playerAddress];
        player.answer = undefined;
        player.answeredAt = undefined;
    }

    let questionCopy = JSON.parse(JSON.stringify(questions[questionIndex]));
    delete questionCopy['Correct Answer'];

    let telnetFormattedQuestion = questions[questionIndex].Question.replace(/<\/?.+?>/g, '');

    sendToTelnetPlayers('');
    sendToTelnetPlayers(`Question ${questionIndex + 1}:`.underline.brightYellow);
    sendToTelnetPlayers(telnetFormattedQuestion);
    sendToTelnetPlayers(`1) ${questions[questionIndex]['Answer 1']}`);
    sendToTelnetPlayers(`2) ${questions[questionIndex]['Answer 2']}`);
    sendToTelnetPlayers(`3) ${questions[questionIndex]['Answer 3']}`);
    sendToTelnetPlayers(`4) ${questions[questionIndex]['Answer 4']}`);

    let playerPayload = Object.assign({}, questions[questionIndex]);
    delete playerPayload['Correct Answer'];

    game.hangingRequests.forEach(function (res) {
        res.end(
            JSON.stringify({
                round: questionIndex,
                question: playerPayload,
                timeleft: QUESTION_TIME,
                started: game.started,
            })
        );
    });
    game.hangingRequests = [];

    startTimer();
}

function sendToTelnetPlayers(text) {
    for (let playerAddress in players) {
        let player = players[playerAddress];
        player.socket.send(text);
    }
}

function showResultAfterQuestion() {
    game.questionShowing = false;

    let answers = [];
    if (!questions[game.questionCounter]) {
        return;
    }

    let someCorrectAnswer;

    for (let playerAddress in players) {
        let player = players[playerAddress];
        let { correctAnswer, answeredCorrectly } = evaluateAnswer(
            players,
            playerAddress,
            questions[game.questionCounter]
        );
        logger.debug(
            `Player ${playerAddress} answered correctly: ${answeredCorrectly}. Correct answer: ${correctAnswer}`
        );

        someCorrectAnswer = correctAnswer;

        if (answeredCorrectly === undefined) {
            player.incorrectAnswers++;
            player.socket.send(
                `Oh noes, you didn't answer! The correct answer was ${correctAnswer}: ${
                    questions[game.questionCounter][`Answer ${correctAnswer}`]
                }`.red
            );
            answers.push({
                name: player.playerName,
                answer: 'nada',
                is_correct: false,
            });
        } else if (answeredCorrectly) {
            player.correctAnswers++;
            player.socket.send(
                `Correct! The answer was ${correctAnswer}: ${
                    questions[game.questionCounter][`Answer ${correctAnswer}`]
                }`.green
            );
            answers.push({
                name: player.playerName,
                answer: player.answer,
                is_correct: true,
            });
        } else {
            player.incorrectAnswers++;
            player.socket.send(
                `WRRROONG! The correct answer was ${correctAnswer}: ${
                    questions[game.questionCounter][`Answer ${correctAnswer}`]
                }`.red
            );
            answers.push({
                name: player.playerName,
                answer: player.answer,
                is_correct: false,
            });
        }
    }

    game.hangingRequests.forEach(function (res) {
        res.end(
            JSON.stringify({
                correct: someCorrectAnswer,
                lastanswers: answers,
            })
        );
    });
    game.hangingRequests = [];

    showStats(false, true);

    if (questions[game.questionCounter + 1]) {
        logger.info(`Next question: ${questions[game.questionCounter + 1].Question}`);
    } else {
        logger.warn('That was the last question');
    }
}

function startTimer() {
    if (questionTimer) {
        clearTimeout(questionTimer);
    }

    questionTimer = setTimeout(showResultAfterQuestion, QUESTION_TIME * 1000);
}

game.getStats = function (onlyHttp) {
    let topPlayers = Object.values(players).sort((player1, player2) => {
        if (player1.correctAnswers > player2.correctAnswers) {
            return -1;
        }
        if (player1.correctAnswers < player2.correctAnswers) {
            return 1;
        }
        if (player1.incorrectAnswers > player2.incorrectAnswers) {
            return 1;
        }
        if (player1.incorrectAnswers < player2.incorrectAnswers) {
            return -1;
        }

        return 0;
    });

    const forWebsite = [];
    let rank;
    let prevPlayer;

    topPlayers.forEach(function (player) {
        if (player.playerName === undefined) {
            return;
        }

        if (!prevPlayer) {
            rank = 1;
        } else if (prevPlayer.correctAnswers !== player.correctAnswers) {
            rank++;
        }

        if (!onlyHttp) {
            sendToTelnetPlayers(
                `${rank}. ${player.playerName}: ${player.correctAnswers} correct, ${player.incorrectAnswers} wrong`
            );
            console.log(
                `${rank}. ${player.playerName}: ${player.correctAnswers} correct, ${player.incorrectAnswers} wrong`
            );
        }

        forWebsite.push({
            rank: rank,
            name: player.playerName,
            correct: player.correctAnswers,
            wrong: player.incorrectAnswers,
        });
        prevPlayer = player;
    });
    return forWebsite;
};

function showStats(onlyHttp, withDelay) {
    if (!onlyHttp) {
        sendToTelnetPlayers('');
        sendToTelnetPlayers('Leaderboard'.underline.blue);
        console.log('Leaderboard'.underline.blue);
    }

    const forWebsite = game.getStats(onlyHttp);

    if (!onlyHttp) {
        sendToTelnetPlayers('');
    }

    setTimeout(
        function () {
            game.hangingRequests.forEach(function (res) {
                res.end(
                    JSON.stringify({
                        scores: forWebsite,
                    })
                );
            });
            game.hangingRequests = [];
        },
        withDelay ? 500 : 0
    );
}

function evaluateAnswer(players, playerId, question) {
    if (!question['Special Flag']) {
        if (!players[playerId].answer) {
            return { correctAnswer: question['Correct Answer'], answeredCorrectly: undefined };
        }

        if (players[playerId].answer === question['Correct Answer']) {
            return { correctAnswer: question['Correct Answer'], answeredCorrectly: true };
        } else {
            return { correctAnswer: question['Correct Answer'], answeredCorrectly: false };
        }
    }

    // Answer selected fewest times
    if (question['Special Flag'] == 1) {
        let answerCount = [999, 0, 0, 0, 0];
        for (let countPlayer in players) {
            if (!players[countPlayer].answer) {
                continue;
            }

            answerCount[players[countPlayer].answer]++;
        }

        let highestCount = Math.min(...answerCount);
        logger.debug(`Highest count: ${highestCount}`);

        for (let i = 1; i <= 4; i++) {
            if (answerCount[i] === highestCount) {
                if (players[playerId].answer == i) {
                    logger.debug(`${playerId} - correct`);
                    return { correctAnswer: i, answeredCorrectly: true };
                }
            }
        }

        return { correctAnswer: answerCount.indexOf(highestCount), answeredCorrectly: false };
    }
    // The fastest to choose
    else if (question['Special Flag'] == 2) {
        let fastestTime = new Date().getTime();
        let fastestPlayer = undefined;

        for (let countPlayer in players) {
            if (!players[countPlayer].answeredAt) {
                continue;
            }

            if (players[countPlayer].answer !== 3) {
                continue;
            }

            if (players[countPlayer].answeredAt.getTime() < fastestTime) {
                fastestTime = players[countPlayer].answeredAt.getTime();
                fastestPlayer = countPlayer;
            }
        }

        if (fastestPlayer === playerId) {
            return { correctAnswer: 3, answeredCorrectly: true };
        } else {
            return { correctAnswer: 3, answeredCorrectly: false };
        }
    }
    // The last to choose
    else if (question['Special Flag'] == 3) {
        let latestTime = 0;
        let latestPlayer = undefined;

        for (let countPlayer in players) {
            if (!players[countPlayer].answeredAt) {
                continue;
            }

            if (players[countPlayer].answer != 1) {
                continue;
            }

            if (players[countPlayer].answeredAt.getTime() > latestTime) {
                latestTime = players[countPlayer].answeredAt.getTime();
                latestPlayer = countPlayer;
            }
        }

        if (latestPlayer === playerId) {
            return { correctAnswer: 1, answeredCorrectly: true };
        } else {
            return { correctAnswer: 1, answeredCorrectly: false };
        }
    } else {
        logger.error('Invalid special flag');
        return { correctAnswer: 1, answeredCorrectly: true };
    }
}

function kick(players, playerId) {
    let player = players[playerId];
    if (!player) {
        let matchingPlayers = Object.values(players).filter((obj) => {
            return obj.playerName == playerId;
        });
        if (matchingPlayers.length) {
            player = matchingPlayers[0];
        }
    }

    if (!player) {
        logger.error('No such player');
        return;
    }

    if (player.socket) {
        logger.debug('Ending socket');
        try {
            player.socket.destroy();
        } catch (err) {
            logger.error('Could not destroy socket');
        }
    }

    delete players[playerId];
    logger.info('Player kicked');
}
