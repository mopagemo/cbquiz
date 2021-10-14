const { MAX_LEADERS, PLAYER_ROWS } = window.quizConfig;

let run = 0;
let countdownTimer;
let countdown;

function autorun() {
    let urlPostfix = '/start';
    if (run) {
        urlPostfix = '/status';
    }
    run++;
    const request = new Request(urlPostfix, {
        method: 'POST',
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
            if (response.round !== undefined && response.started) {
                document.querySelector('.pre-game').style.display = 'none';
                document.querySelector('.game-round').innerHTML = response.round;
                document.querySelector('.during-game').style.display = 'block';
            }
            if (response.scores) {
                let tableHTML =
                    '<table><thead><tr><th>Rank</th><th>Player</th><th>Correct</th><th>Wrong</th></tr></thead><tbody>';
                let counter = 0;
                response.scores.forEach(function (player) {
                    if (++counter > MAX_LEADERS && player.name != name) {
                        return;
                    }
                    tableHTML += `
                            <tr>
                            <td class="rank">${player.rank}.</td>
                            <td class="name">${escapeHtml(player.name)}</td>
                            <td class="qcorrect">${player.correct}</td>
                            <td class="qwrong">${player.wrong}</td>
                            </tr>
                        `;
                });
                tableHTML += `</tbody></table>`;
                document.querySelector('.leaders').innerHTML = tableHTML;
            }
            if (response.question) {
                document.querySelector('.answerboard').style.display = 'none';
                document.querySelector('.answers').innerHTML = '';

                document.querySelectorAll('.correct').forEach(function (item) {
                    item.style.display = 'none';
                });

                // Yes, I want HTML support. Screw you XSS.
                document.querySelector('.question').innerHTML = response.question.Question;

                [1, 2, 3, 4].forEach((i) => {
                    let answerContainer = document.querySelector(`.answer${i}`);
                    let answerContainerSize = answerContainer.scrollWidth - 20;

                    let answer = response.question[`Answer ${i}`];

                    let tryFontSize;

                    for(tryFontSize = 37; tryFontSize > 8; tryFontSize--) {
                        if(textWidth(answer, tryFontSize) < answerContainerSize) {
                            break;
                        }
                    }

                    answerContainer.style.fontSize = tryFontSize + 'pt';
                    answerContainer.innerHTML = answer;
                });
            }
            if (response.correct) {
                document.querySelector('.correct' + response.correct).style.display = 'block';
            }
            if (response.lastanswers) {
                document.querySelector('.answerboard').style.display = 'block';
                let tableHTML =
                    '<table><thead><tr><th>Player</th><th>Answer</th><th>Player</th><th>Answer</th><th>Player</th><th>Answer</th></tr></thead><tbody>';
                let resultCounter = 0;
                response.lastanswers.forEach(function (player) {
                    if (resultCounter % PLAYER_ROWS == 0) {
                        tableHTML += `
    <tr>
    `;
                    }
                    tableHTML += `
    <td class="${player.is_correct ? 'is-correct' : 'is-wrong'}">${player.name}</td>
    <td class="player-answer ${player.is_correct ? 'is-correct' : 'is-wrong'}">${player.answer}</td>
    `;
                    resultCounter++;
                    if (resultCounter % PLAYER_ROWS == 0) {
                        tableHTML += `</tr>`;
                    }
                });
                if (resultCounter % PLAYER_ROWS != 0) {
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
            setTimeout(function () {
                autorun(1);
            }, 10);
        })
        .catch((error) => {
            setTimeout(function () {
                autorun(1);
            }, 1000);
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
if (document.addEventListener) document.addEventListener('DOMContentLoaded', autorun, false);
else if (document.attachEvent) document.attachEvent('onreadystatechange', autorun);
else window.onload = autorun;
