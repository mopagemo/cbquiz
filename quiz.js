#!/usr/bin/env node

/* jshint esversion: 6 */

const csv = require('csvtojson');
const fs = require('fs');
const http = require('http');
const path = require('path');
const readline = require('readline');
const net = require('net');
const util = require('util');
const winston = require('winston');

const {
    createLogger,
    format,
    transports
} = winston;

const logger = createLogger({
    level: 'info',
    format: format.combine(
        format.splat(),
        format.colorize(),
        format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        format.printf(info => `${info.timestamp} ${info.level}: ${info.message}`)
    ),
    transports: [new transports.Console()]
});

const rl = readline.createInterface({
    input: process.stdin,
});
rl.on('line', (input) => {
    processAdmin(input);
});

let gameStarted = false;
let questionShowing = false;
let questionTimer;

let questions;
let questionCounter = -1;

let QUESTION_TIME = 15;

let state = {};

let hangingRequests = [];

loadQuestions();
setupHTTP(3300, setupRequestHandler());
setupTelnet(1337);

function handleInput(socket, state, input) {
    if (!state.has_name) {
        socket.info(`name set to ${input}`);
        return save_name(socket, state, input);
    }

    if (input === 'change_name') {
        socket.send('Enter a new name:');
        state.has_name = false;
        return;
    }

    if (!gameStarted) {
        socket.send('Chill out mate, we have not started yet'.red);
        return;
    }

    if (!input.match(/^\d$/) || input > 4 || input < 1) {
        socket.send('Invalid answer. Choose 1-4.'.red);
        return;
    }

    if (questionShowing) {
        if (!state.answer || state.answer === input) {
            socket.send(`Selected answer: ${input}`);
            state.answeredAt = new Date();
        } else {
            socket.send(`Changed answer from ${state.answer} to ${input}`);
        }
        state.answer = input;
    } else {
        socket.send('Too late :('.red)
    }
}

function save_name(socket, state, input) {
    input = input.replace(/[^a-zA-Z]/g, '');
    if (!input) {
        socket.send('Invalid name. Try again.'.red);
        return
    }
    state.player_name = input;
    state.has_name = true;
    socket.logging_name = input;
    socket.player = input;
    socket.send('Name set to: %s. Please stand by...', input);
    showStats(true);
}

function processAdmin(input) {
    if (input === 'start') {
        questionCounter = 0;
        showQuestion(0);
    } else if (input.match(/q ?(\d+)/)) {
        questionCounter = parseInt(RegExp.$1);
        showQuestion(questionCounter);
    } else if (input === 'next' || input === 'n') {
        questionCounter++;
        showQuestion(questionCounter);
    } else if (input === 'board' || input === 'stats') {
        showStats();
    } else if (input === 'webboard' || input === 'webstats') {
        showStats(true);
    } else if (input.match(/^time ?(\d+)$/)) {
        QUESTION_TIME = parseInt(RegExp.$1);
        logger.info('setting timeout to ' + QUESTION_TIME);
    } else if (input === 'debug' || input === 'debug on') {
        logger.level = 'debug';
        logger.debug('debug enabled');
    } else if (input === 'debug off') {
        logger.level = 'info';
        logger.info('debug disabled');
    } else if (input === 'debug state') {
        for (let playerId in state) {
            logger.info(`* ${playerId}: ${player_name} - ${state[playerId].telnet ? 'telnet' : 'web'}`);
        }
    } else {
        logger.error('eh?');
    }
}

function showQuestion(questionIndex) {
    if (!questions[questionIndex]) {
        logger.error('invalid question ID');
        return;
    }

    logger.info(`Showing question ${questionIndex + 1} / ${questions.length}`);
    gameStarted = true;
    questionShowing = true;

    for (let playerAddress in state) {
        let player = state[playerAddress];
        player.answer = undefined;
        player.answeredAt = undefined;
    }

    let questionCopy = JSON.parse(JSON.stringify(questions[questionIndex]));
    delete questionCopy['Correct Answer'];

    sendToTelnetPlayers('');
    sendToTelnetPlayers(`Question ${questionIndex + 1}:`.underline.brightYellow);
    sendToTelnetPlayers(questions[questionIndex].Question);
    sendToTelnetPlayers('1) ' + questions[questionIndex]['Answer 1']);
    sendToTelnetPlayers('2) ' + questions[questionIndex]['Answer 2']);
    sendToTelnetPlayers('3) ' + questions[questionIndex]['Answer 3']);
    sendToTelnetPlayers('4) ' + questions[questionIndex]['Answer 4']);

    hangingRequests.forEach(function(res) {
        res.end(JSON.stringify({
            round: questionIndex,
            question: questions[questionIndex],
            timeleft: QUESTION_TIME,
            started: gameStarted
        }));
    });
    hangingRequests = [];

    startTimer();
}

function sendToTelnetPlayers(text) {
    for (let playerAddress in state) {
        let player = state[playerAddress];
        player.socket.send(text);
    }
}

function showResultAfterQuestion() {
    questionShowing = false;

    let answers = [];
    if (!questions[questionCounter]) {
        return;
    }

    let someCorrectAnswer;

    for (let playerAddress in state) {
        let player = state[playerAddress];
        let { correctAnswer, answeredCorrectly } = evaluateAnswer(state, playerAddress, questions[questionCounter]);
        logger.debug(`Player ${playerAddress} answered correctly: ${answeredCorrectly}. Correct answer: ${correctAnswer}`);

        someCorrectAnswer = correctAnswer;

        if (answeredCorrectly === undefined) {
            player.incorrectAnswers++;
            player.socket.send(`Oh noes, you didn't answer! The correct answer was ${correctAnswer}: ${questions[questionCounter]['Answer ' + correctAnswer]}`.red);
            answers.push({
                name: player.player_name,
                answer: 'nada',
                is_correct: false
            });
        } else if (answeredCorrectly) {
            player.correctAnswers++;
            player.socket.send(`Correct! The answer was ${correctAnswer}: ${questions[questionCounter]['Answer ' + correctAnswer]}`.green);
            answers.push({
                name: player.player_name,
                answer: player.answer,
                is_correct: true
            });
        } else {
            player.incorrectAnswers++;
            player.socket.send(`WRRROONG! The correct answer was ${correctAnswer}: ${questions[questionCounter]['Answer ' + correctAnswer]}`.red);
            answers.push({
                name: player.player_name,
                answer: player.answer,
                is_correct: false
            });
        }
    }

    hangingRequests.forEach(function(res) {
        res.end(JSON.stringify({
            correct: someCorrectAnswer,
            lastanswers: answers
        }));
    });
    hangingRequests = [];

    showStats(false, true);

    if (questions[questionCounter + 1]) {
        logger.info(`Next question: ${questions[questionCounter + 1].Question}`);
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

function getStats(onlyHttp) {
    let topPlayers = Object.values(state).sort((player1, player2) => {
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

    let rank;
    let prevPlayer;
    let forWebsite = [];
    topPlayers.forEach(function(player) {
        if (player.player_name === undefined) {
            return;
        }

        if (!prevPlayer) {
            rank = 1;
        } else if (prevPlayer.correctAnswers !== player.correctAnswers) {
            rank++;
        }

        if (!onlyHttp) {
            sendToTelnetPlayers(`${rank}. ${player.player_name}: ${player.correctAnswers} correct, ${player.incorrectAnswers} wrong`);
            console.log(`${rank}. ${player.player_name}: ${player.correctAnswers} correct, ${player.incorrectAnswers} wrong`);
        }

        forWebsite.push({
            rank: rank,
            name: player.player_name,
            correct: player.correctAnswers,
            wrong: player.incorrectAnswers
        });
        prevPlayer = player;
    });
    return forWebsite;
}

function showStats(onlyHttp, withDelay) {
    if (!onlyHttp) {
        sendToTelnetPlayers('');
        sendToTelnetPlayers('Leaderboard'.underline.blue);
        console.log('Leaderboard'.underline.blue);
    }

    let forWebsite = getStats(onlyHttp);

    if (!onlyHttp) {
        sendToTelnetPlayers('');
    }

    setTimeout(function() {
        hangingRequests.forEach(function(res) {
            res.end(JSON.stringify({
                scores: forWebsite
            }));
        });
        hangingRequests = [];
    }, withDelay ? 500 : 0);
}

function setupRequestHandler() {
    return (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,name,sessionId');
        res.setHeader('Access-Control-Allow-Credentials', true);
        res.setHeader('Content-Type', 'application/json');

        logger.debug(`${req.headers.name} - ${req.method} ${req.url}`);

        if (req.method === 'OPTIONS') {
            res.end();
            return;
        }

        if (req.url === '/register-name') {
            if (!req.headers.sessionid || !req.headers.name) {
                res.end(JSON.stringify({
                    success: false
                }));
                return;
            }

            state[req.headers.sessionid] = {
                correctAnswers: -1,
                incorrectAnswers: 0,
                player_name: req.headers.name,
                socket: { send: function() {} }
            };
            res.end(JSON.stringify({
                success: true
            }));

            logger.info(`${req.headers.name} - connected`);

            return;
        }

        if (req.url === '/start') {
            res.end(JSON.stringify({
                round: questionCounter,
                started: gameStarted
            }));
            return;
        }

        if (req.url.match(/^\/answer\/(\d)$/)) {
            let answer = RegExp.$1;

            if (!state[req.headers.sessionid]) {
                logger.warn(`${req.headers.name} - missing state... reinit`);
                state[req.headers.sessionid] = {
                    correctAnswers: 0,
                    incorrectAnswers: 0,
                    player_name: req.headers.name
                };
            }

            setAnswer(state[req.headers.sessionid], state[req.headers.sessionid].answer);

            res.end(JSON.stringify({
                success: true,
                setTo: answer
            }));

            logger.info(`${req.headers.name} - answer ${answer}`);
            return;
        }

        if (req.url === '/' || req.url === '') {
            const filePath = path.join(__dirname, 'player.html');
            const stat = fs.statSync(filePath);
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Content-Length': stat.size
            });
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
            return;
        }

        if (req.url == '/readonly') {
            const filePath = path.join(__dirname, 'monitor.html');
            const stat = fs.statSync(filePath);
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Content-Length': stat.size
            });
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
            return;
        }

        if (req.url.match(/\/(.+?\.png)$/)) {
            const filePath = path.join(__dirname, RegExp.$1);
            const stat = fs.statSync(filePath);
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': stat.size
            });
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
            return;
        }

        if (req.url === '/status') {
            hangingRequests.push(res);
            return;
        }

        if (req.url === '/status/nowait') {
            res.end(JSON.stringify({
                scores: getStats(true),
                round: questionCounter,
                started: gameStarted
            }));
            return;
        }

        res.writeHead(404, { "Content-Type": "text/plain" });
        res.write("404 Not Found\n");
        res.end();
    }
}

function setupTelnet(port) {
    const server = net.createServer(function(socket) {
        const logging_name = socket.logging_name = socket.remoteAddress;

        // Setup logging on socket object
        ['info', 'warn', 'error', 'verbose'].forEach(level => {
            socket[level] = (msg, interpolate) => logger[level](`${socket.logging_name} ${msg}`, interpolate);
        });

        // Easy writing to socket
        socket.send = function(msg, interpolate) {
            if (!socket.writable) {
                return;
            }

            if (interpolate !== undefined) {
                socket.write(util.format(msg, interpolate).bold + '\r\n');
            } else {
                socket.write(msg.bold + '\r\n');
            }
        };

        socket.info('connected');

        socket.send('');
        socket.send('');
        socket.send('Welcome to the Cloudbeds Quiz 2020');
        socket.send('=================================='.rainbow);
        socket.send('');

        if (!state[socket.remoteAddress]) {
            state[socket.remoteAddress] = {};
            state[socket.remoteAddress].correctAnswers = 0;
            state[socket.remoteAddress].incorrectAnswers = 0;
        }

        state[socket.remoteAddress].socket = socket;
        state[socket.remoteAddress].telnet = true;

        if (state[socket.remoteAddress].player_name) {
            save_name(socket, state[socket.remoteAddress], state[socket.remoteAddress].player_name);
        } else {
            socket.send('Enter your player name (change later with "change_name"):');
        }

        socket.on('data', function(data) {
            data = data.toString().replace(/[\n\r]/g, '');
            if (data === '')
                return;

            socket.verbose('data: %s', data);

            handleInput(socket, state[socket.remoteAddress], data);
        });

        socket.on('error', function(err) {
            if (socket && socket.error)
                socket.error('error: %s', err);
            else
                logger.error(`${logging_name} %s`, err);
        });

        socket.on('close', function() {
            if (socket && socket.warning)
                socket.warning('disconnected');
            else
                logger.warn(`${logging_name} disconnected`);
        });
    });

    server.listen(port);

    logger.info(`telnet server is listening on ${port}`);

    server.on('error', function(err) {
        logger.error('server-event:error %s', err);
    });
}

function loadQuestions() {
    const csvFilePath = process.argv[2] || 'questions.csv';

    csv()
        .fromFile(csvFilePath)
        .then((jsonObj) => {
            questions = jsonObj;
        });
}

function evaluateAnswer(players, playerId, question) {
    if (!question['Special Flag']) {
        if (!players[playerId].answer) {
            return { correctAnswer: question['Correct Answer'], answeredCorrectly: false };
        }

        if (players[playerId].answer === question['Correct Answer']) {
            return { correctAnswer: question['Correct Answer'], answeredCorrectly: true };
        } else {
            return { correctAnswer: question['Correct Answer'], answeredCorrectly: false };
        }
    }

    // Answer selected fewest times
    if (question['Special Flag'] === 1) {
        let answerCount = [999, 0, 0, 0, 0];
        for (let countPlayer in players) {
            if (!players[countPlayer].answer) {
                continue;
            }

            answerCount[players[countPlayer].answer]++;
        }

        let highestCount = Math.min(...answerCount);
        for (let i = 1; i <= 4; i++) {
            if (answerCount[i] === highestCount) {
                if (players[playerId].answer === i) {
                    return { correctAnswer: i, answeredCorrectly: true };
                }
            }
        }

        return { correctAnswer: answerCount.indexOf(highestCount), answeredCorrectly: false };
    }
    // The fastest to choose
    else if (question['Special Flag'] === 2) {
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
    else if (question['Special Flag'] === 3) {
        let latestTime = 0;
        let latestPlayer = undefined;

        for (let countPlayer in players) {
            if (!players[countPlayer].answeredAt) {
                continue;
            }

            if (players[countPlayer].answer !== 1) {
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
    }
    // Wat?
    else {
        logger.error('Invalid special flag');
        return { correctAnswer: 1, answeredCorrectly: true };
    }
}

function setAnswer(player, answer) {
    if (!player.answer) {
        logger.debug(`${player.player_name} sets answer to ${answer}`);
        if (questions[questionCounter]['Special Flag'] === 2 && answer === 3) {
            player.answeredAt = new Date();
        } else if (questions[questionCounter]['Special Flag'] !== 2) {
            player.answeredAt = new Date();
        }
    } else {
        logger.debug(`${player.player_name} changes answer to ${answer}`);
    }

    player.answer = answer;
}

function setupHTTP(port, requestHandler) {
    const httpServer = http.createServer(requestHandler);

    httpServer.listen(port, (err) => {
        if (err) {
            return logger.error('something bad happened', err)
        }

        logger.info(`web server is listening on ${port} - http://localhost:${port}`);
    });
}


