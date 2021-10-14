window.quizConfig = {
    PLAYER_ROWS: 3,
    MAX_LEADERS: 10,
};

function escapeHtml(unsafe) {
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
 }

function textWidth(text, fontSize) {
    var tag = document.createElement('div')
    tag.style.position = 'absolute';
    tag.style.left = '-99in';
    tag.style.whiteSpace = 'nowrap';
    tag.style.fontSize = fontSize + 'pt';
    tag.innerHTML = text;

    document.body.appendChild(tag);
    var result = tag.clientWidth;
    document.body.removeChild(tag);
    return result;
}
