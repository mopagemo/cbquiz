const sessionId = localStorage.getItem('sessionid') || Math.random();
localStorage.setItem('sessionid', sessionId);

const { MAX_LEADERS, PLAYER_ROWS } = window.quizConfig;

let countdownTimer;
let countdown;
let lastAnswer;
let acceptAnswer = false;
let name;

function autorun() {
    document.querySelector('.set-name').addEventListener('click', setName);
    document.querySelectorAll('.answer').forEach(function (item) {
        item.addEventListener('click', sendAnswer);
    });

    document.onkeypress = keyPressed;
}

function setName() {
    name = document.querySelector('.player-name').value;
    if (!name) {
        alert('Please enter a name!');
        return;
    }
    sendRequest('/register-name', poll);
    poll(true);
    document.querySelector('.name-entry').style.display = 'none';
}

function poll(noWait) {
    let url = '/status';
    if (noWait) {
        url = '/status/nowait';
    }
    sendRequest(url, function (err, response) {
        if (err) {
            if (noWait) {
                return;
            }

            setTimeout(function () {
                poll();
            }, 1000);
            return;
        }

        if (response.round !== undefined && response.started) {
            document.querySelector('.round').textContent = 'Question ' + response.round;
        }
        if (response.scores) {
            let tableHTML =
                '<table><thead><tr><th>Rank</th><th>Player</th><th>Correct</th><th>Wrong</th></tr></thead><tbody>';
            let counter = 0;
            response.scores.forEach(function (player) {
                if (++counter > MAX_LEADERS && player.name !== name) {
                    return;
                }
                tableHTML += `
                        <tr>
                        <td class="rank">${player.rank}.</td>
                        <td class="name">${player.name}</td>
                        <td class="qcorrect">${player.correct}</td>
                        <td class="qwrong">${player.wrong}</td>
                        </tr>
                    `;
            });
            tableHTML += `</tbody></table>`;
            document.querySelector('.leaders').innerHTML = tableHTML;
        }
        if (response.question) {
            clearLocked();
            acceptAnswer = true;
            lastAnswer = null;
            document.querySelector('.answerboard').style.display = 'none';
            document.querySelector('.answers').innerHTML = '';

            document.querySelectorAll('.correct').forEach(function (item) {
                item.style.display = 'none';
            });

            // Yes, I want HTML support. Screw you XSS.
            document.querySelector('.question').innerHTML = response.question.Question;

            [1, 2, 3, 4].forEach((i) => {
                let answerContainer = document.querySelector(`.answer${i}`);
                let answer = response.question[`Answer ${i}`];
                if (answer.length <= 12) {
                    answerContainer.style.fontSize = '2.5vw';
                } else if (answer.length <= 15) {
                    answerContainer.style.fontSize = '2.2vw';
                } else if (answer.length <= 20) {
                    answerContainer.style.fontSize = '1.7vw';
                } else if (answer.length <= 25) {
                    answerContainer.style.fontSize = '1.4vw';
                } else if (answer.length <= 50) {
                    answerContainer.style.fontSize = '1.2vw';
                } else if (answer.length <= 70) {
                    answerContainer.style.fontSize = '1.0vw';
                } else {
                    answerContainer.style.fontSize = '0.9vw';
                }
                answerContainer.textContent = answer;
            });
        }
        if (response.correct) {
            acceptAnswer = false;
            document.querySelector('.correct' + response.correct).style.display = 'block';
        }
        if (response.lastanswers) {
            document.querySelector('.answerboard').style.display = 'block';
            let tableHTML =
                '<table><thead><tr><th>Player</th><th>Answer</th><th>Player</th><th>Answer</th><th>Player</th><th>Answer</th></tr></thead><tbody>';
            let resultCounter = 0;
            response.lastanswers.forEach(function (player) {
                if (resultCounter % PLAYER_ROWS === 0) {
                    tableHTML += `
                            <tr>
                        `;
                }
                tableHTML += `
                        <td class="${player.is_correct ? 'is-correct' : 'is-wrong'}">${player.name}</td>
                        <td class="player-answer ${player.is_correct ? 'is-correct' : 'is-wrong'}">${player.answer}</td>
                    `;
                resultCounter++;
                if (resultCounter % PLAYER_ROWS === 0) {
                    tableHTML += `</tr>`;
                }
            });
            if (resultCounter % PLAYER_ROWS !== 0) {
                tableHTML += `</tr>`;
            }
            tableHTML += `</tbody></table>`;
            document.querySelector('.answers').innerHTML = tableHTML;
        }
        if (response.timeleft) {
            if (countdownTimer) {
                clearTimeout(countdownTimer);
            }
            countdown = response.timeleft;
            countdownTimer = setInterval(updateCountdown, 1000);
            updateCountdown();
        }
        if (noWait) {
            return;
        }
        setTimeout(function () {
            poll();
        }, 10);
    });
}

function updateCountdown() {
    if (!countdown) {
        clearTimeout(countdownTimer);
        document.querySelector('.countdown').style.display = 'none';
        return;
    }

    document.querySelector('.countdown').style.display = 'block';
    document.querySelector('.countdown').textContent = countdown;
    countdown--;
}

function sendAnswer(ev) {
    if (!acceptAnswer) return;

    clearLocked();

    if (ev.target.className.match(/(\d)$/)) {
        let answer = RegExp.$1;
        lastAnswer = answer;

        document.querySelector('.locked' + answer).style.display = 'block';

        sendRequest('/answer/' + answer);
    } else {
        console.log('Invalid answer');
    }
}

function keyPressed(ev) {
    if (!acceptAnswer) return;

    if (!name || !ev || !ev.key) {
        return;
    }

    let chosenAnswer = ev.key;

    clearLocked();
    if (chosenAnswer.match(/^(\d)$/) && chosenAnswer >= 1 && chosenAnswer <= 4) {
        document.querySelector('.locked' + chosenAnswer).style.display = 'block';
        sendRequest('/answer/' + chosenAnswer);
    }
}

function sendRequest(postfix, cb) {
    const myHeaders = new Headers();
    myHeaders.append('name', name);
    myHeaders.append('sessionid', sessionId);

    const request = new Request(postfix, {
        method: 'POST',
        headers: {
            name: name,
            sessionId: sessionId,
        },
    });
    fetch(request)
        .then((response) => {
            if (response.status === 200) {
                return response.json();
            } else {
                throw new Error('Something went wrong on api server!');
            }
        })
        .then((response) => {
            console.log('incoming', response);
            if (cb) {
                cb(null, response);
            }
        })
        .catch((error) => {
            console.log('fetch error', error);
            cb(error);
        });
}

function clearLocked() {
    document.querySelectorAll('.locked').forEach(function (item) {
        item.style.display = 'none';
    });
}

if (document.addEventListener) document.addEventListener('DOMContentLoaded', autorun, false);
else if (document.attachEvent) document.attachEvent('onreadystatechange', autorun);
else window.onload = autorun;
