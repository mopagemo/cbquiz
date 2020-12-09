const csvToJson = require('csvtojson');

const questions = [];

exports.loadQuestions = function(csvFilePath) {
    csvToJson()
        .fromFile(csvFilePath)
        .then((questionsFromJson) => {
            questions.push(...questionsFromJson);
        });
}

exports.questions = questions;

