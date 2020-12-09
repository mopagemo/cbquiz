const fs = require('fs');
const http = require('http');
const path = require('path');

const logger = require('./logger');
const { questions } = require('./questions');

const RequestUrls = {
    AnswerRegex: /^\/answer\/(\d)$/,

    AssetsRegex: /\/(.+?\.(?:png|css|js))$/,
    PngRegex: /\/(.+?\.png)$/,
    CssRegex: /\/(.+?\.css)$/,
    JsRegex: /\/(.+?\.js)$/,

    RegisterName: '/register-name',
    ReadOnly: '/readonly',
    Start: '/start',
    Status: '/status',
    StatusNoWait: '/status/nowait',
};

function setAnswer(game, player, answer) {
    if (!player.answer) {
        logger.debug(`${player.playerName} sets answer to ${answer}`);
        if (questions[game.questionCounter]['Special Flag'] === 2 && answer === 3) {
            player.answeredAt = new Date();
        } else if (questions[game.questionCounter]['Special Flag'] !== 2) {
            player.answeredAt = new Date();
        }
    } else {
        logger.debug(`${player.playerName} changes answer to ${answer}`);
    }

    player.answer = answer;
}

function setupRequestHandler(game, players) {
    return (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
        res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,name,sessionId');
        res.setHeader('Access-Control-Allow-Credentials', true);
        res.setHeader('Content-Type', 'application/json');

        logger.debug(`${req.headers.name || '<START>'} - ${req.method} ${req.url}`);

        if (req.method === 'OPTIONS') {
            res.end();
            return;
        }

        if (req.url === RequestUrls.RegisterName) {
            if (!req.headers.sessionid || !req.headers.name) {
                res.end(
                    JSON.stringify({
                        success: false,
                    })
                );
                return;
            }

            players[req.headers.sessionid] = {
                correctAnswers: -1,
                incorrectAnswers: 0,
                playerName: req.headers.name,
                socket: { send: function () {} },
            };
            res.end(
                JSON.stringify({
                    success: true,
                })
            );

            logger.info(`${req.headers.name} - connected`);

            return;
        }

        if (req.url === RequestUrls.Start) {
            res.end(
                JSON.stringify({
                    round: game.questionCounter,
                    started: game.started,
                })
            );
            return;
        }

        if (RequestUrls.AnswerRegex.test(req.url)) {
            let answer = RegExp.$1;

            if (!players[req.headers.sessionid]) {
                logger.warn(`${req.headers.name} - missing player state... reinit`);
                players[req.headers.sessionid] = {
                    correctAnswers: 0,
                    incorrectAnswers: 0,
                    playerName: req.headers.name,
                };
            }

            setAnswer(game, players[req.headers.sessionid], answer);

            res.end(
                JSON.stringify({
                    success: true,
                    setTo: answer,
                })
            );

            logger.info(`${req.headers.name} - answer ${answer}`);
            return;
        }

        if (['', '/'].includes(req.url)) {
            const filePath = path.join(__dirname, 'pages', 'player.html');
            const stat = fs.statSync(filePath);
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Content-Length': stat.size,
            });
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
            return;
        }

        if (req.url === RequestUrls.ReadOnly) {
            const filePath = path.join(__dirname, 'pages', 'monitor.html');
            const stat = fs.statSync(filePath);
            res.writeHead(200, {
                'Content-Type': 'text/html',
                'Content-Length': stat.size,
            });
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
            return;
        }

        if (RequestUrls.AssetsRegex.test(req.url)) {
            const filePath = path.join(__dirname, 'pages', RegExp.$1);
            const stat = fs.statSync(filePath);
            let contentType;
            if (RequestUrls.PngRegex.test(req.url)) {
                contentType = 'image/png';
            } else if (RequestUrls.CssRegex.test(req.url)) {
                contentType = 'text/css';
            } else if (RequestUrls.JsRegex.test(req.url)) {
                contentType = 'text/javascript';
            }
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': stat.size,
            });
            const readStream = fs.createReadStream(filePath);
            readStream.pipe(res);
            return;
        }

        if (req.url === RequestUrls.Status) {
            game.hangingRequests.push(res);
            return;
        }

        if (req.url === RequestUrls.StatusNoWait) {
            res.end(
                JSON.stringify({
                    scores: game.getStats(true),
                    round: game.questionCounter,
                    started: game.started,
                })
            );
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.write('404 Not Found\n');
        res.end();
    };
}

module.exports = function setupHTTP(port, game, players) {
    const requestHandler = setupRequestHandler(game, players);
    const httpServer = http.createServer(requestHandler);

    httpServer.listen(port, (err) => {
        if (err) {
            return logger.error('something bad happened', err);
        }

        logger.info(`web server is listening on ${port} - http://localhost:${port}`);
    });
};
