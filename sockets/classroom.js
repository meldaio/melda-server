const {
SocketError,
} = require("./utils");
const wildcardMiddleware = require("socketio-wildcard")();
const UserError = require("../lib/user-error.js");
const classroomManager = require("../lib/classroom-manager");

class ClassroomSocketError extends SocketError {}

const EXCLUDE_FROM_WILDCARD = ["join", "leave", "forceShutdown"];
const classes = require("../classes.json");
const _ = require("lodash");
const fs = require('fs');

module.exports = function (WS_SERVER) {
const server = WS_SERVER.of("/classroom");

server.use(wildcardMiddleware).on("connection", (socket) => {
    socket.on("*", async ({ data }) => {
    const [event, ...inputs] = data;

    if (EXCLUDE_FROM_WILDCARD.includes(event)) return;
    });

    socket.on("join", async (params) => {
    try {
        socket.join(params.uri);
        // const classroom = classroomManager.startMeeting(params.meetingID);
        // classes[params.uri] = {meetings: [params], students: [], creator: socket.request.session.user};
        // fs.writeFileSync('classes.json', JSON.stringify(classes));
        // params.creator = socket.request.session.user;
        // socket.broadcast.emit("meeting-started", params) // uri, join
    } catch (error) {
        socket.emit("classroom-error", handleError(error));
    }
});

    socket.on("test-join", async (params) => {
    try {
        socket.join(params.meetingID);
        const classroom = classroomManager.startMeeting(params.meetingID);
        classes[params.uri] = {meetings: [params], students: [], creator: {uri: params.meeting.name}};
        fs.writeFileSync('classes.json', JSON.stringify(classes));
        params.creator = params.meeting.name;
        socket.broadcast.emit("meeting-started", params) // uri, join
    } catch (error) {
        socket.emit("classroom-error", handleError(error));
    }
    });
    socket.on('show-classes', (data) => {
        for (let i = 0; data.classes.length > i; i++) {

            if (!_.get(classes, data.classes[i])) {
                classes[data.classes[i]] = {
                    students: [],
                    meetings: []
                }
            }
            if (!data.student)
                return;
            classes[data.classes[i]].students.push(socket.id)
            if (classes[data.classes[i]].meetings.length > 0) {
                _.map(classes[data.classes[i]].meetings, meeting => 
                    socket.emit('meeting-started', meeting)
                )
            }
        }
    })
    socket.on("add-user", async (params) => {
        try {
            socket.broadcast.emit("user-added", params)
        } catch (error) {
            socket.emit("classroom-error", handleError(error));
        }
    });
    socket.on("user-left", async (params) => {
        try {
            socket.broadcast.emit("remove-user", params)
        } catch (error) {
            socket.emit("classroom-error", handleError(error));
        }
    });
    socket.on("user-list", async (params) => {
        try {
            socket.broadcast.emit("user-list-updated", params)
        } catch (error) {
            socket.emit("classroom-error", handleError(error));
        }
    });
    socket.on("add-moderator", async (params) => {
        try {
            socket.broadcast.emit("moderator-added", params)
        } catch (error) {
            socket.emit("classroom-error", handleError(error));
        }
    });
    socket.on("project-selection", async (params) => {
        try {
            socket.broadcast.emit("project-selected", params)
        } catch (error) {
            socket.emit("classroom-error", handleError(error));
        }
    });
    socket.on("send-alert", async (params) => {
        try {
            socket.broadcast.emit("alert-sended", params)
        } catch (error) {
            socket.emit("classroom-error", handleError(error));
        }
    });
    socket.on("send-question", async (params) => {
        try {
            socket.broadcast.emit("question-sended", params)
        } catch (error) {
            socket.emit("classroom-error", handleError(error));
        }
    });
    socket.on("cell-evaluation", async (params) => {
        try {
            socket.broadcast.emit("cell-evaluated", params)
        } catch (error) {
            socket.emit("classroom-error", handleError(error));
        }
    });
    socket.on("cursor-moved", async (params) => {
        try {
            socket.broadcast.emit("follow-cursor", params)
        } catch (error) {
            socket.emit("classroom-error", handleError(error));
        }
    });
    //socket.on("disconnecting", () => leaveClassroom(socket));
    socket.on("leave", (params) => leaveClassroom(socket, params));
});

function handleError(error) {
    if (!(error instanceof UserError)) {
    error = new ClassroomSocketError("Unknown error", error);
    console.error(error);
    }
    return error.export();
}

function getMeetingID(socket) {
    return Object.values(socket.rooms).find((room) =>
    room.match(/^[a-f0-9]{24}$/)
    );
}

function leaveClassroom(socket, params) {
    socket.broadcast.emit("meeting-ended", params)
    socket.leave(params.meetingID);
    delete classes[params.meeting.uri];
    fs.writeFileSync('classes.json', JSON.stringify(classes));
}
};