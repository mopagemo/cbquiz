const fs = require('fs');
const http = require('http');
const path = require('path');

const handlebars = require('handlebars');

const logger = require('./logger');
const { questions } = require('./questions');

const RequestUrls = {
    AnswerRegex: /^\/answer\/(\d)$/,

    AssetsRegex: /\/(.+?\.(?:png|css|js|ico))$/,
    PngRegex: /\/(.+?\.png)$/,
    CssRegex: /\/(.+?\.css)$/,
    JsRegex: /\/(.+?\.js)$/,
    IcoRegex: /\/(.+?\.ico)$/,

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
    let handicap = 0;
    if(game.templateVars.httpHandicap) {
        handicap = game.templateVars.httpHandicap;
    }

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
                correctAnswers: handicap,
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
                    socket: { send: function () {} },
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
            sendHTML(res, filePath, game);
            return;
        }

        if (req.url === RequestUrls.ReadOnly) {
            const filePath = path.join(__dirname, 'pages', 'monitor.html');
            sendHTML(res, filePath, game);
            return;
        }

        if (RequestUrls.AssetsRegex.test(req.url)) {
            const filePath = path.join(__dirname, 'pages', RegExp.$1);
            try {
                const stat = fs.statSync(filePath);
                let contentType;
                if (RequestUrls.PngRegex.test(req.url)) {
                    contentType = 'image/png';
                } else if (RequestUrls.CssRegex.test(req.url)) {
                    contentType = 'text/css';
                } else if (RequestUrls.JsRegex.test(req.url)) {
                    contentType = 'text/javascript';
                } else if (RequestUrls.IcoRegex.test(req.url)) {
                    contentType = 'image/x-icon';
                }
                res.writeHead(200, {
                    'Content-Type': contentType,
                    'Content-Length': stat.size,
                    'Cache-Control': 'max-age=172800',
                });
                const readStream = fs.createReadStream(filePath);
                readStream.pipe(res);
            } catch(err) {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.write('404 Not Found\n');
                res.end();
            }
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

        logger.info(`web server is listening on ${port} - ${game.templateVars.httpHost}`);
    });
};

function sendHTML(res, filepath, game) {
    const stat = fs.statSync(filepath);
    res.writeHead(200, {
        'Content-Type': 'text/html',
    });

    const template = handlebars.compile(fs.readFileSync(filepath).toString());
    res.end(template(game.templateVars));
}
