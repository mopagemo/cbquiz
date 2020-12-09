const csvToJson = require('csvtojson');

const questions = {};

exports.loadQuestions = function(csvFilePath) {
    csvToJson()
        .fromFile(csvFilePath)
        .then((jsonObj) => {
            Object.assign(questions, jsonObj);
        });
}

exports.questions = questions;

