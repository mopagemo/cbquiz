const net = require('net');
const util = require('util');

const logger = require('./logger');

function handleInput(socket, game, state, input) {
    if (!state.has_name) {
        socket.info(`name set to ${input}`);
        return saveName(socket, state, input);
    }

    if (input === 'change_name') {
        socket.send('Enter a new name:');
        state.has_name = false;
        return;
    }

    if (!game.started) {
        socket.send('Chill out mate, we have not started yet'.red);
        return;
    }

    if (!input.match(/^\d$/) || input > 4 || input < 1) {
        socket.send('Invalid answer. Choose 1-4.'.red);
        return;
    }

    if (game.questionShowing) {
        if (!state.answer || state.answer === input) {
            socket.send(`Selected answer: ${input}`);
            state.answeredAt = new Date();
        } else {
            socket.send(`Changed answer from ${state.answer} to ${input}`);
        }
        state.answer = input;
    } else {
        socket.send('Too late :('.red);
    }
}

function saveName(socket, state, input, showStats) {
    input = input.replace(/[^a-zA-Z]/g, '');
    if (!input) {
        socket.send('Invalid name. Try again.'.red);
        return;
    }
    state.playerName = input;
    state.has_name = true;
    socket.logging_name = input;
    socket.player = input;
    socket.send('Name set to: %s. Please stand by...', input);
    showStats(true);
}

module.exports = function setupTelnet(port, game, players) {
    const server = net.createServer(function (socket) {
        const logging_name = (socket.logging_name = socket.remoteAddress);

        // Setup logging on socket object
        ['info', 'warn', 'error', 'verbose'].forEach((level) => {
            socket[level] = (msg, interpolate) => logger[level](`${socket.logging_name} ${msg}`, interpolate);
        });

        // Easy writing to socket
        socket.send = function (msg, interpolate) {
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

        if (!players[socket.remoteAddress]) {
            players[socket.remoteAddress] = {};
            players[socket.remoteAddress].correctAnswers = 0;
            players[socket.remoteAddress].incorrectAnswers = 0;
        }

        players[socket.remoteAddress].socket = socket;
        players[socket.remoteAddress].telnet = true;

        if (players[socket.remoteAddress].playerName) {
            saveName(socket, players[socket.remoteAddress], players[socket.remoteAddress].playerName, game.showStats);
        } else {
            socket.send('Enter your player name (change later with "change_name"):');
        }

        socket.on('data', function (data) {
            data = data.toString().replace(/[\n\r]/g, '');
            if (data === '') return;

            socket.verbose('data: %s', data);

            handleInput(socket, game, players[socket.remoteAddress], data);
        });

        socket.on('error', function (err) {
            if (socket && socket.error) socket.error('error: %s', err);
            else logger.error(`${logging_name} %s`, err);
        });

        socket.on('close', function () {
            if (socket && socket.warning) socket.warning('disconnected');
            else logger.warn(`${logging_name} disconnected`);
        });
    });

    server.listen(port);

    logger.info(`telnet server is listening on ${port}`);

    server.on('error', function (err) {
        logger.error('server-event:error %s', err);
    });
};
