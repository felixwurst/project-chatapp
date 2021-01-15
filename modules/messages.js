const moment = require('moment');
const runQuery = require('./connection');

function insertMessage(message, userID, roomID) {
    return new Promise((resolve, reject) => {
        // replace backslashes in a message with their entity to avoid errors in mySQL and JSON
        runQuery(`
              INSERT INTO messages (message, userID, roomID)
              Values ('${message.replace(/\\/g, "&#92;")}', ${userID}, ${roomID})
    `).then(response => {
            resolve(response);
        }).catch(err => {
            reject(err);
        });
    });
};

function getMessages(room, pageNum = 0) {
    return new Promise((resolve, reject) => {
        runQuery(`
              SELECT messages.*, users.username as username FROM messages
              INNER JOIN rooms ON messages.roomID = rooms.ID
              INNER JOIN users ON messages.userID = users.ID
              WHERE rooms.room LIKE '${room}' 
              ORDER BY message_time DESC LIMIT 8 OFFSET ${pageNum}
    `).then(messages => {
            resolve(messages.map(message => {
                message.message = message.message.toString();
                return message;
            }));
        }).catch(err => {
            reject(err);
        });
    });
};

function getMessage(msg_ID) {
    return new Promise((resolve, reject) => {
        runQuery(`
              SELECT messages.* FROM messages
              WHERE messages.ID = ${msg_ID}
    `).then(message => {
            resolve(message);
        }).catch(err => {
            reject(err);
        });
    });
};

function formatMessage(username, text, actTime = moment().format('DD.MM.YY H:mm')) {
    return {
        username,
        text,
        time: actTime
    };
};

module.exports = {
    insertMessage,
    formatMessage,
    getMessages,
    getMessage
};