# cbquiz

Who-wants-to-be-a-millionaire-style self-hosted quizzes

This script is pretty much everything you need. Run it from a publicly reachable
server. Can be used via web browser or telnet/netcat.

## Ports

- Default HTTP port: 3300
- Default netcat/telnet port: 1337

# Usage

`npm install`

Then start with `./quiz.js my-questions.csv`.
Alternatively start by executing `./quiz.js` or `npm start` which will use `questions.csv` file.
Custom ports can be specified with the `port` and `telnet-port` flags, e.g.

```
./quiz.js my-questions.csv --http-port 9000 --telnet-port 3333
```

All command line options:

- `http-port`: which port to run the webserver on (default: `3300`)
- `http-host`: which URL the webserver can be reached at, for display to participants only (default: `http://localhost:${port}`)
- `telnet-port`: which port to listen for telnet/netcat (default: `1337`)
- `telnet-host`: which host to show to the participants for connecting to (default `localhost`)
- `http-handicap`: negative points to give to people connecting via HTTP instead of telnet, because telnet is more l33t (default: `0`)
- `title`: what the quiz is called. Shown when asking participants to enter their name (default: `quiz`)

`questions.csv` needs to look like this:

```
Question,Answer 1,Answer 2,Answer 3,Answer 4,Difficulty (1-5 stars),Correct Answer
What's the answer to life, the universe, everything?,π,1,42,>9000,2,3
[...]
```

The `Difficulty (1-5 stars)` column is not used by the script and is only
present for sorting by difficulty in Google Sheets.

Admin commands are accepted via command line at run time. Commands:

- `start`: starts the quiz with the first question
- `q 3`: skip to question 3
- `next` or `n`: go to next question
- `board` or `stats`: update/display leaderboard to all clients (debugging use mostly)
- `webboard` or `webstats`: update leaderboard to all HTTP clients (debugging use mostly)
- `time 10` or `t 10`: change question timeout to 10 seconds
- `debug` or `debug on`: turn on debug level logging
- `debug off`: turn of debug level logging
- `debug state`: outputs information about connected clients

To not participate and to share questions/results on screen go to
`http://localhost:3300/readonly`. This uses the `monitor.html` file, whereas
participating players use `player.html`.
