/* ************************************************************ SETUP ******************************************************* */
// imports
const path = require('path');
const http = require('http');
const moment = require('moment');
const express = require('express');
const app = express();
const fs = require('fs');
const socketio = require('socket.io');
const Entities = require('html-entities').XmlEntities;
const entities = new Entities();

// modules
const {
    insertMessage,
    formatMessage,
    getMessages,
    getMessage
} = require('./modules/messages');
const {
    registerUser,
    loginUser,
    joinUsersRoom,
    leaveUsersRoom,
    getUsersRoom,
    verifyUser
} = require('./modules/users');
const {
    getRooms,
    getRoom,
    getRoomAndUser,
    createRoom
} = require('./modules/rooms');

// socketio server
const server = http.createServer(app);
const io = socketio(server);

// session
// const session = require('express-session')({
//   secret: "chat",
//   resave: true,
//   saveUninitialized: true
// });var sharedsession = require("express-socket.io-session");
// app.use(session);
// io.use(sharedsession(session, {
//   autoSave:true
// }));

const session = require('express-session');
app.use(session({
    secret: "chat",
    resave: true,
    saveUninitialized: true
}));

// set static folder
app.use(express.static(path.join(__dirname, 'public')));
// set body-parser
app.use(express.urlencoded({ extended: false }));
// parses incoming requests with json payloads to an object
app.use(express.json());

// set view engine
app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

// globals
const botName = 'ChatApp Bot';

/* ************************************************************ SOCKET.IO ******************************************************* */

// run when client connects
io.on('connection', socket => {

    // join to chatroom
    socket.on('joinRoom', ({ username, userID, room, roomID }) => {
        // create user object
        const user = { username, userID, room, roomID };
        // combine userID and roomID and store their relation into db
        joinUsersRoom(user.userID, user.roomID, socket.id).then(() => {
            // subscribe to a given channel
            socket.join(user.room);
            // welcome current user
            socket.emit('message', formatMessage(botName, 'Welcome to ChatApp!'));
            // broadcast when a user connects
            socket.broadcast.to(user.room).emit('message', formatMessage(botName, `${user.username} has joined the chat.`));
            // get the current users in this room from db
            getUsersRoom(user.room).then(users => {
                const usersArr = [];
                users.forEach(user => {
                    usersArr.push(user.username);
                });
                // send users and room info
                io.to(user.room).emit('roomUsers', { room: user.room, users: usersArr });
            }).catch(err => {
                // send an empty array of users because db request failed
                io.to(user.room).emit('roomUsers', { room: user.room, users: [] });
            });
        }).catch(err => {
            // db is not able to save user & room relation and sends user back to room page
            socket.emit('redirect');
        });
    });

    // listen for old messages
    socket.on('old-messages', ({ room, pageNum }) => {
        // get history of messages from db
        if (room) {
            getMessages(room, pageNum).then(messages => {
                const msgs = [];
                messages.forEach(msg => {
                    msgs.push({
                        username: msg.username,
                        text: msg.message,
                        time: moment(msg.message_time).format('DD.MM.YY H:mm')
                    });
                    socket.emit('history', formatMessage(msg.username, msg.message, moment(msg.message_time).format('DD.MM.YY H:mm')));
                });
            }).catch(err => {
                console.log(err);
            });
        };
    });

    // listen for chatMessage
    socket.on('chatMessage', ({ msg, username, userID, room, roomID }) => {
        // const userID = socket.handshake.session.userID;
        const user = { msg, username, userID, room, roomID };
        // save message to db
        insertMessage(entities.encode(user.msg), user.userID, user.roomID).then((response) => {
            getMessage(response.insertId).then(data => {
                io.to(user.room).emit('message', formatMessage(user.username, user.msg, moment(data[0].message_time).format('DD.MM.YY H:mm')));
            }).catch(err => {
                console.log(err);
            });
        }).catch(err => {
            socket.emit('message', formatMessage(botName, 'Error! Not able to save message!'));
        });
    });

    // listen for image
    socket.on('image', async ({ base64, filename, username, userID, room, roomID }) => {
        // const userID = socket.handshake.session.userID;
        const user = { username, userID, room, roomID };
        // get extension from file
        const ext = filename.substr(filename.lastIndexOf('.'));
        // set new filename from roomname, userID and timestamp
        const newFilename = room.trim().replace(/ /g, '_') + '_' + userID + '_' + Date.now() + ext;
        // set image URL
        const imgUrl = '/upload/' + newFilename;
        // set image path
        const imgPath = './public/upload/' + newFilename;
        // buffer image file
        const buffer = Buffer.from(base64, 'base64');
        // get filesize of image in MB
        let imgSize = Buffer.byteLength(buffer) / (1024 * 1024);
        // validate size of image
        if (imgSize < 6) {
            // save image into upload folder
            await fs.writeFile(imgPath, buffer, err => {
                if (err) {
                    socket.emit('message', formatMessage(botName, 'Error! Not able to save image!'));
                } else {
                    // save message to db
                    insertMessage(imgUrl, user.userID, user.roomID).then(() => {
                        io.to(user.room).emit('message', formatMessage(user.username, imgUrl));
                    }).catch(err => {
                        socket.emit('message', formatMessage(botName, 'Error! Not able to save image to db!'));
                        // delete image from upload folder if image Url is not saved to db
                        fs.unlinkSync(imgPath);
                    });
                };
            });
        };
    });

    // runs when client disconnects
    socket.on('disconnect', () => {
        // get room and user by socketID from db
        getRoomAndUser(socket.id).then(result => {
            const room = result[0].room;
            const username = result[0].username;
            // delete user & room correlation from database when user lefts the room
            leaveUsersRoom(socket.id).then(() => {
                // get the current users in this room from db
                getUsersRoom(room).then(users => {
                    const usersArr = [];
                    users.forEach(user => {
                        usersArr.push(user.username);
                    });
                    // send info to chatroom that user has left the chat
                    io.to(room).emit('message', formatMessage(botName, `${username} has left the chat.`));
                    // send users and room info
                    io.to(room).emit('roomUsers', { room: room, users: usersArr });
                }).catch(err => {
                    // send info to chatroom that user has left the chat
                    io.to(room).emit('message', formatMessage(botName, `${username} has left the chat.`));
                    // send an empty array of users because db request failed
                    io.to(room).emit('roomUsers', { room: room, users: [] });
                });
            }).catch(err => {
                // send info to chatroom that user has left the chat
                io.to(room).emit('message', formatMessage(botName, `${username} has left the chat.`));
                // send an empty array of users because db request failed
                io.to(room).emit('roomUsers', { room: room, users: [] });
            });
        }).catch(err => {
            console.log(err);
        });
    });

});

/* ************************************************************ ROUTES ******************************************************* */
// route to main
app.get('/', (req, res) => {
    // check if valid user
    if (req.session.user) {
        res.redirect('/room');
    } else {
        res.render('main');
    }
});

// handle with register or login data
app.post('/', (req, res) => {
    const firstname = req.body.firstname;
    const lastname = req.body.lastname;
    const username = req.body.username;
    const email = req.body.email;
    const password = req.body.password;
    const repassword = req.body.repassword;
    // 1 login successful
    // 2 user already exists
    // 3 user not found
    // 4 server error
    // 5 missing entries
    // 6 not verified
    // 7 registration successful
    if (firstname && lastname && username && email && password && password === repassword) {
        registerUser(firstname, lastname, username, email, password).then(() => {
            res.json(7);
        }).catch(err => {
            if (err === "exists") {
                res.json(2);
            } else {
                res.json(4);
            };
        });
    } else if (username && password) {
        loginUser(username, password).then(user => {
            req.session.user = user.username;
            req.session.userID = user.ID;
            res.json(1);
        }).catch(err => {
            if (err === 3) {
                res.json(3);
            } else if (err === 6) {
                res.json(6);
            } else {
                res.json(4);
            };
        });
    } else {
        res.json(5);
    };
});

// verify user
app.get('/verify/:email', (req, res) => {
    verifyUser(req.params.email).then(() => {
        res.send("You've verified your account!");
    }).catch(err => {
        console.log(err);
    });
});

// route to room
app.get('/room', (req, res) => {
    // check if valid user
    if (req.session.user) {
        // get rooms from db
        getRooms().then(rooms => {
            res.render('room', { rooms });
        }).catch(err => {
            res.redirect('/');
        });
    } else {
        res.redirect('/');
    };
});

// handle with data to create a new chatroom
app.post('/room', (req, res) => {
    // 1 creating a room was successful
    // 2 room already exists
    // 3 creating a room was not successful
    // 4 server error
    if (req.body.roomname) {
        // insert a new room into db
        createRoom(req.body.roomname).then(() => {
            res.json(1);
        }).catch(err => {
            if (err === 'exists') {
                res.json(2);
            } else {
                res.json(3);
            };
        });
    } else {
        res.json(4);
    };
});

// route to chat
app.get('/chat/:room', (req, res) => {
    // check if valid user
    if (req.session.user) {
        if (req.params.room) {
            // get room-element from db
            getRoom(req.params.room).then(room => {
                const roomID = room[0].ID;
                // get history of messages from db
                getMessages(req.params.room).then(messages => {
                    const msgs = [];
                    messages.forEach(msg => {
                        msgs.unshift({
                            username: msg.username,
                            text: msg.message,
                            time: moment(msg.message_time).format('DD.MM.YY H:mm')
                        });
                    });
                    // render room chat with old messages
                    res.render('chat', { username: req.session.user, userID: req.session.userID, room: req.params.room, roomID, oldmessages: JSON.stringify(msgs) });
                }).catch(err => {
                    // render room chat without old messages
                    res.render('chat', { username: req.session.user, userID: req.session.userID, room: req.params.room, roomID, oldmessages: JSON.stringify([]) });
                });
            }).catch(err => {
                res.redirect('/room');
            });
        } else {
            res.redirect('/room');
        };
    } else {
        res.redirect('/');
    };
});

// route to logout
app.get('/logout', (req, res) => {
    // destroys the session from user & logs him out
    req.session.destroy();
    res.redirect('/');
});

/* ************************************************************ PORT ******************************************************* */

const PORT = process.env.PORT || 4000;

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
