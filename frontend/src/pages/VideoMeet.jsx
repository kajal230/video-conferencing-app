 

 

import React, { useEffect, useRef, useState } from 'react'
import io from "socket.io-client";
import { Badge, IconButton, TextField } from '@mui/material';
import { Button } from '@mui/material';
import VideocamIcon from '@mui/icons-material/Videocam';
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import styles from "../styles/videoComponent.module.css";
import CallEndIcon from '@mui/icons-material/CallEnd'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import ScreenShareIcon from '@mui/icons-material/ScreenShare';
import StopScreenShareIcon from '@mui/icons-material/StopScreenShare'
import ChatIcon from '@mui/icons-material/Chat'

const server_url = "http://localhost:8000";

var connections = {};

const peerConfigConnections = {
    "iceServers": [
        { "urls": "stun:stun.l.google.com:19302" }
    ]
}

export default function VideoMeetComponent() {

    var socketRef = useRef();
    let socketIdRef = useRef();

    const lobbyVideoRef = useRef(null);
    const meetingVideoRef = useRef(null);

    const [videoAvailable, setVideoAvailable] = useState(true);
    const [audioAvailable, setAudioAvailable] = useState(true);
    const [video, setVideo] = useState(false);
    const [audio, setAudio] = useState(false);
    const [screen, setScreen] = useState(false);
    const [showModal, setModal] = useState(true);
    const [screenAvailable, setScreenAvailable] = useState(false);
    const [mediaError, setMediaError] = useState("");
    const [localStream, setLocalStream] = useState(null);
    const [videoTrackCount, setVideoTrackCount] = useState(0);
    const [audioTrackCount, setAudioTrackCount] = useState(0);
    const localStreamRef = useRef(null);
    const [socketStatus, setSocketStatus] = useState("disconnected");
    const [socketError, setSocketError] = useState("");

    const setLocalStreamState = (stream) => {
        window.localStream = stream;
        localStreamRef.current = stream;
        setLocalStream(stream);
        setVideoTrackCount(stream?.getVideoTracks().length ?? 0);
        setAudioTrackCount(stream?.getAudioTracks().length ?? 0);
    };

    const attachLocalStream = (stream) => {
        [lobbyVideoRef, meetingVideoRef].forEach(ref => {
            if (ref.current) {
                ref.current.srcObject = stream;
                if (typeof ref.current.play === 'function') {
                    ref.current.play().catch(() => {});
                }
            }
        });
    };

    let [messages, setMessages] = useState([])

    let [message, setMessage] = useState("");

    let [newMessages, setNewMessages] = useState(3);

    let [askForUsername, setAskForUsername] = useState(true);

    let [username, setUsername] = useState("");

    const getCurrentVideoRef = () => askForUsername ? lobbyVideoRef : meetingVideoRef;

    const videoRef = useRef([])

    let [videos, setVideos] = useState([])

    // TODO
    // if(isChrome() === false) {


    // }

    useEffect(() => {
        if (localStream) {
            attachLocalStream(localStream);
        }
    }, [localStream, askForUsername])

    const handleGetUserMediaError = (e) => {
        console.log(e)
        if (e.name === 'NotFoundError') {
            setMediaError('Requested device not found. Please connect a camera or microphone.');
        } else if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
            setMediaError('Camera or microphone permission denied. Please allow access in your browser.');
        } else {
            setMediaError(`Unable to start camera or microphone: ${e.name}. Check browser permissions and device settings.`);
        }
    }

    const updateLocalStreamTracks = async () => {
        const currentStream = localStreamRef.current || window.localStream;
        if (!currentStream) return;

        let renegotiate = false;
        const videoTracks = currentStream.getVideoTracks();
        const audioTracks = currentStream.getAudioTracks();

        if (video) {
            if (videoTracks.length === 0) {
                try {
                    const newVideo = await navigator.mediaDevices.getUserMedia({ video: true });
                    newVideo.getVideoTracks().forEach(track => currentStream.addTrack(track));
                    renegotiate = true;
                } catch (e) {
                    setVideo(false);
                    handleGetUserMediaError(e);
                    return;
                }
            }
            currentStream.getVideoTracks().forEach(track => track.enabled = true);
        } else {
            videoTracks.forEach(track => track.enabled = false);
        }

        if (audio) {
            if (audioTracks.length === 0) {
                try {
                    const newAudio = await navigator.mediaDevices.getUserMedia({ audio: true });
                    newAudio.getAudioTracks().forEach(track => currentStream.addTrack(track));
                    renegotiate = true;
                } catch (e) {
                    setAudio(false);
                    handleGetUserMediaError(e);
                    return;
                }
            }
            currentStream.getAudioTracks().forEach(track => track.enabled = true);
        } else {
            audioTracks.forEach(track => track.enabled = false);
        }

        setLocalStreamState(currentStream);
        attachLocalStream(currentStream);

        if (renegotiate) {
            for (let id in connections) {
                if (id === socketIdRef.current) continue;
                try {
                    connections[id].addStream(currentStream);
                    connections[id].createOffer().then((description) => {
                        connections[id].setLocalDescription(description)
                            .then(() => {
                                socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                            })
                            .catch(e => console.log(e))
                    }).catch(e => console.log(e))
                } catch (e) {
                    console.log('Unable to renegotiate peer after track change', e)
                }
            }
        }
    }

    let getDislayMedia = () => {
        if (screen) {
            if (navigator.mediaDevices.getDisplayMedia) {
                navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
                    .then(getDislayMediaSuccess)
                    .then((stream) => { })
                    .catch((e) => console.log(e))
            }
        }
    }

    const getPermissions = async () => {
        let hasVideo = false;
        let hasAudio = false;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setMediaError('Browser does not support getUserMedia. Use a modern browser on localhost or HTTPS.');
            setVideoAvailable(false);
            setAudioAvailable(false);
            setScreenAvailable(false);
            return;
        }

        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const hasCameraDevice = devices.some(device => device.kind === 'videoinput');
            const hasMicrophoneDevice = devices.some(device => device.kind === 'audioinput');

            if (!hasCameraDevice && !hasMicrophoneDevice) {
                setMediaError('No camera or microphone devices were found. Connect a device and reload.');
                setVideoAvailable(false);
                setAudioAvailable(false);
                setScreenAvailable(!!navigator.mediaDevices.getDisplayMedia);
                return;
            }

            try {
                const userMediaStream = await navigator.mediaDevices.getUserMedia({
                    video: hasCameraDevice,
                    audio: hasMicrophoneDevice
                });
                hasVideo = userMediaStream.getVideoTracks().length > 0;
                hasAudio = userMediaStream.getAudioTracks().length > 0;
                setLocalStreamState(userMediaStream);
                attachLocalStream(userMediaStream);
                setMediaError("");
            } catch (error) {
                console.log('Combined video/audio permission failed:', error);
                setMediaError(`Unable to access camera/microphone: ${error.name}. Check browser permissions.`);

                if (hasCameraDevice) {
                    try {
                        const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                        const videoHasTrack = videoStream.getVideoTracks().length > 0;
                        if (videoHasTrack) {
                            hasVideo = true;
                            if (!window.localStream) {
                                setLocalStreamState(videoStream);
                                attachLocalStream(videoStream);
                            }
                        }
                    } catch (videoError) {
                        console.log('Video only request failed:', videoError);
                    }
                }

                if (hasMicrophoneDevice) {
                    try {
                        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        const audioHasTrack = audioStream.getAudioTracks().length > 0;
                        if (audioHasTrack) {
                            hasAudio = true;
                            const baseStream = window.localStream || new MediaStream();
                            audioStream.getAudioTracks().forEach(track => baseStream.addTrack(track));
                            setLocalStreamState(baseStream);
                            attachLocalStream(baseStream);
                        }
                    } catch (audioError) {
                        console.log('Audio only request failed:', audioError);
                    }
                }

                if (!hasVideo && !hasAudio) {
                    attachLocalStream(null);
                    setLocalStreamState(null);
                }
            }
        } catch (enumerationError) {
            console.log('Device enumeration failed:', enumerationError);
            setMediaError('Unable to enumerate media devices. Check browser privacy settings.');
            attachLocalStream(null);
            setLocalStreamState(null);
        }

        setVideoAvailable(hasVideo);
        setAudioAvailable(hasAudio);
        setScreenAvailable(!!navigator.mediaDevices.getDisplayMedia);
    };

    useEffect(() => {
        if (window.localStream) {
            updateLocalStreamTracks();
        } else if (video || audio) {
            getUserMedia();
        }
        console.log("SET STATE HAS ", video, audio);
    }, [video, audio])
    let getMedia = () => {
        setVideo(videoAvailable);
        setAudio(audioAvailable);
        connectToSocketServer();

    }




    let getUserMediaSuccess = (stream) => {
        try {
            window.localStream.getTracks().forEach(track => track.stop())
        } catch (e) { console.log(e) }

        setLocalStreamState(stream)
        if (getCurrentVideoRef().current) {
            getCurrentVideoRef().current.srcObject = stream
            getCurrentVideoRef().current.play().catch(() => {})
        }

        for (let id in connections) {
            if (id === socketIdRef.current) continue

            connections[id].addStream(window.localStream)

            connections[id].createOffer().then((description) => {
                console.log(description)
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                    })
                    .catch(e => console.log(e))
            })
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setVideo(false);
            setAudio(false);

            try {
                let tracks = getCurrentVideoRef().current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { console.log(e) }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()])
            window.localStream = blackSilence()
            getCurrentVideoRef().current.srcObject = window.localStream

            for (let id in connections) {
                connections[id].addStream(window.localStream)

                connections[id].createOffer().then((description) => {
                    connections[id].setLocalDescription(description)
                        .then(() => {
                            socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                        })
                        .catch(e => console.log(e))
                })
            }
        })
    }

    let getUserMedia = () => {
        if (window.localStream) {
            updateLocalStreamTracks();
            return;
        }

        if ((video && videoAvailable) || (audio && audioAvailable)) {
            navigator.mediaDevices.getUserMedia({ video: video, audio: audio })
                .then(getUserMediaSuccess)
                .then(() => { setMediaError(""); })
                .catch((e) => {
                    handleGetUserMediaError(e)
                })
        } else {
            try {
                let tracks = getCurrentVideoRef().current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { }
        }
    }





    let getDislayMediaSuccess = (stream) => {
        console.log("HERE")
        try {
            window.localStream.getTracks().forEach(track => track.stop())
        } catch (e) { console.log(e) }

        setLocalStreamState(stream)
        if (getCurrentVideoRef().current) {
            getCurrentVideoRef().current.srcObject = stream
            getCurrentVideoRef().current.play().catch(() => {})
        }

        for (let id in connections) {
            if (id === socketIdRef.current) continue

            connections[id].addStream(window.localStream)

            connections[id].createOffer().then((description) => {
                connections[id].setLocalDescription(description)
                    .then(() => {
                        socketRef.current.emit('signal', id, JSON.stringify({ 'sdp': connections[id].localDescription }))
                    })
                    .catch(e => console.log(e))
            })
        }

        stream.getTracks().forEach(track => track.onended = () => {
            setScreen(false)

            try {
                let tracks = getCurrentVideoRef().current.srcObject.getTracks()
                tracks.forEach(track => track.stop())
            } catch (e) { console.log(e) }

            let blackSilence = (...args) => new MediaStream([black(...args), silence()])
            window.localStream = blackSilence()
            getCurrentVideoRef().current.srcObject = window.localStream

            getUserMedia()

        })
    }

    let gotMessageFromServer = (fromId, message) => {
        var signal = JSON.parse(message)

        if (fromId !== socketIdRef.current) {
            if (!connections[fromId]) {
                console.warn('Received signal for unknown peer:', fromId, signal)
                return
            }

            if (signal.sdp) {
                connections[fromId].setRemoteDescription(new RTCSessionDescription(signal.sdp)).then(() => {
                    if (signal.sdp.type === 'offer') {
                        connections[fromId].createAnswer().then((description) => {
                            connections[fromId].setLocalDescription(description).then(() => {
                                socketRef.current.emit('signal', fromId, JSON.stringify({ 'sdp': connections[fromId].localDescription }))
                            }).catch(e => console.log(e))
                        }).catch(e => console.log(e))
                    }
                }).catch(e => console.log(e))
            }

            if (signal.ice) {
                connections[fromId].addIceCandidate(new RTCIceCandidate(signal.ice)).catch(e => console.log(e))
            }
        }
    }




    let connectToSocketServer = () => {
        console.log('Connecting socket to', server_url)
        setSocketStatus('connecting')
        setSocketError("")
        socketRef.current = io.connect(server_url, { secure: false })

        socketRef.current.on('connect', () => {
            console.log('Socket connected to', server_url, 'id=', socketRef.current.id)
            setSocketStatus('connected')
            socketRef.current.emit('join-call', window.location.href)
            socketIdRef.current = socketRef.current.id

            socketRef.current.on('chat-message', addMessage)

            socketRef.current.on('user-left', (id) => {
                setVideos((videos) => videos.filter((video) => video.socketId !== id))
            })

            socketRef.current.on('user-joined', (id, clients) => {
                clients.forEach((socketListId) => {
                    if (socketListId === socketIdRef.current) return;

                    connections[socketListId] = new RTCPeerConnection(peerConfigConnections)
                    // Wait for their ice candidate       
                    connections[socketListId].onicecandidate = function (event) {
                        if (event.candidate != null) {
                            socketRef.current.emit('signal', socketListId, JSON.stringify({ 'ice': event.candidate }))
                        }
                    }

                    // Wait for their video stream
                    connections[socketListId].onaddstream = (event) => {
                        console.log("BEFORE:", videoRef.current);
                        console.log("FINDING ID: ", socketListId);

                        let videoExists = videoRef.current.find(video => video.socketId === socketListId);

                        if (videoExists) {
                            console.log("FOUND EXISTING");

                            // Update the stream of the existing video
                            setVideos(videos => {
                                const updatedVideos = videos.map(video =>
                                    video.socketId === socketListId ? { ...video, stream: event.stream } : video
                                );
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        } else {
                            // Create a new video
                            console.log("CREATING NEW");
                            let newVideo = {
                                socketId: socketListId,
                                stream: event.stream,
                                autoplay: true,
                                playsinline: true
                            };

                            setVideos(videos => {
                                const updatedVideos = [...videos, newVideo];
                                videoRef.current = updatedVideos;
                                return updatedVideos;
                            });
                        }
                    };


                    // Add the local video stream
                    if (window.localStream !== undefined && window.localStream !== null) {
                        connections[socketListId].addStream(window.localStream)
                    } else {
                        let blackSilence = (...args) => new MediaStream([black(...args), silence()])
                        window.localStream = blackSilence()
                        connections[socketListId].addStream(window.localStream)
                    }
                })

                if (id === socketIdRef.current) {
                    for (let id2 in connections) {
                        if (id2 === socketIdRef.current) continue

                        try {
                            connections[id2].addStream(window.localStream)
                        } catch (e) { }

                        connections[id2].createOffer().then((description) => {
                            connections[id2].setLocalDescription(description)
                                .then(() => {
                                    socketRef.current.emit('signal', id2, JSON.stringify({ 'sdp': connections[id2].localDescription }))
                                })
                                .catch(e => console.log(e))
                        })
                    }
                }
            })
        })

        socketRef.current.on('connect_error', (error) => {
            console.error('Socket connect_error', error)
            setSocketStatus('error')
            setSocketError(error.message || String(error))
        })

        socketRef.current.on('connect_timeout', () => {
            console.error('Socket connect_timeout')
            setSocketStatus('timeout')
            setSocketError('Connection timed out')
        })

        socketRef.current.on('disconnect', (reason) => {
            console.warn('Socket disconnected:', reason)
            setSocketStatus('disconnected')
            if (reason !== 'io client disconnect') {
                setSocketError(reason)
            }
        })

        socketRef.current.on('signal', gotMessageFromServer)

        socketRef.current.on('error', (error) => {
            console.error('Socket error', error)
            setSocketStatus('error')
            setSocketError(error.message || String(error))
        })
    }

    let silence = () => {
        let ctx = new AudioContext()
        let oscillator = ctx.createOscillator()
        let dst = oscillator.connect(ctx.createMediaStreamDestination())
        oscillator.start()
        ctx.resume()
        return Object.assign(dst.stream.getAudioTracks()[0], { enabled: false })
    }
    let black = ({ width = 640, height = 480 } = {}) => {
        let canvas = Object.assign(document.createElement("canvas"), { width, height })
        canvas.getContext('2d').fillRect(0, 0, width, height)
        let stream = canvas.captureStream()
        return Object.assign(stream.getVideoTracks()[0], { enabled: false })
    }

    let handleVideo = () => {
        setVideo(!video);
        // getUserMedia();
    }
    let handleAudio = async () => {
        setMediaError("");
        const nextAudio = !audio;
        setAudio(nextAudio);

        const currentStream = localStreamRef.current || window.localStream;
        if (!currentStream) {
            setMediaError('Local media stream is not ready yet. Re-enter the room and allow microphone access.');
            return;
        }

        if (nextAudio) {
            if (currentStream.getAudioTracks().length === 0) {
                try {
                    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    audioStream.getAudioTracks().forEach(track => currentStream.addTrack(track));
                } catch (e) {
                    setAudio(false);
                    handleGetUserMediaError(e);
                    return;
                }
            }
            currentStream.getAudioTracks().forEach(track => track.enabled = true);
        } else {
            currentStream.getAudioTracks().forEach(track => track.enabled = false);
        }

        setLocalStreamState(currentStream);
        attachLocalStream(currentStream);
        updateLocalStreamTracks();
    }

    useEffect(() => {
        if (screen) {
            getDislayMedia();
        }
    }, [screen])
    let handleScreen = () => {
        setScreen(!screen);
    }

    let handleEndCall = () => {
        try {
            let tracks = getCurrentVideoRef().current.srcObject.getTracks()
            tracks.forEach(track => track.stop())
        } catch (e) { }
        window.location.href = "/"
    }

    let openChat = () => {
        setModal(true);
        setNewMessages(0);
    }
    let closeChat = () => {
        setModal(false);
    }
    let handleMessage = (e) => {
        setMessage(e.target.value);
    }

    const addMessage = (data, sender, socketIdSender) => {
        setMessages((prevMessages) => [
            ...prevMessages,
            { sender: sender, data: data }
        ]);
        if (socketIdSender !== socketIdRef.current) {
            setNewMessages((prevNewMessages) => prevNewMessages + 1);
        }
    };



    let sendMessage = () => {
        console.log(socketRef.current);
        socketRef.current.emit('chat-message', message, username)
        setMessage("");

        // this.setState({ message: "", sender: username })
    }

    
    let connect = async () => {
        await getPermissions();
        if (!window.localStream) {
            return;
        }
        setAskForUsername(false);
        attachLocalStream(window.localStream);
        getMedia();
    }


    return (
        <div>

            {askForUsername === true ?

                <div>


                    <h2>Enter into Lobby </h2>
                    <TextField id="outlined-basic" label="Username" value={username} onChange={e => setUsername(e.target.value)} variant="outlined" />
                    <Button variant="contained" onClick={connect}>Connect</Button>


                    <div>
                        <video ref={lobbyVideoRef} autoPlay muted playsInline></video>
                        {mediaError && <p style={{ color: 'red', marginTop: '12px' }}>{mediaError}</p>}
                        <p style={{ color: 'lightgreen', marginTop: '8px' }}>
                            Local stream: {localStream ? 'active' : 'none'} | video tracks: {videoTrackCount} | audio tracks: {audioTrackCount}
                        </p>
                        <p style={{ color: 'white', marginTop: '8px' }}>
                            Socket URL: {server_url}
                        </p>
                        <p style={{ color: 'white', marginTop: '4px' }}>
                            Socket status: {socketStatus} {socketError ? `| ${socketError}` : ''}
                        </p>
                    </div>

                </div> :


                <div className={styles.meetVideoContainer}>

                    {showModal ? <div className={styles.chatRoom}>

                        <div className={styles.chatContainer}>
                            <h1>Chat</h1>

                            <div className={styles.chattingDisplay}>

                                {messages.length !== 0 ? messages.map((item, index) => {

                                    console.log(messages)
                                    return (
                                        <div style={{ marginBottom: "20px" }} key={index}>
                                            <p style={{ fontWeight: "bold" }}>{item.sender}</p>
                                            <p>{item.data}</p>
                                        </div>
                                    )
                                }) : <p>No Messages Yet</p>}


                            </div>

                            <div className={styles.chattingArea}>
                                <TextField value={message} onChange={(e) => setMessage(e.target.value)} id="outlined-basic" label="Enter Your chat" variant="outlined" />
                                <Button variant='contained' onClick={sendMessage}>Send</Button>
                            </div>


                        </div>
                    </div> : <></>}


                    <div className={styles.buttonContainers}>
                        <IconButton onClick={handleVideo} style={{ color: "white" }}>
                            {(video === true) ? <VideocamIcon /> : <VideocamOffIcon />}
                        </IconButton>
                        <IconButton onClick={handleEndCall} style={{ color: "red" }}>
                            <CallEndIcon  />
                        </IconButton>
                        <IconButton onClick={handleAudio} style={{ color: "white" }}>
                            {audio === true ? <MicIcon /> : <MicOffIcon />}
                        </IconButton>

                        {screenAvailable === true ?
                            <IconButton onClick={handleScreen} style={{ color: "white" }}>
                                {screen === false ? <ScreenShareIcon /> : <StopScreenShareIcon />}
                            </IconButton> : <></>}

                        <Badge badgeContent={newMessages} max={999} color='orange'>
                            <IconButton onClick={() => setModal(!showModal)} style={{ color: "white" }}>
                                <ChatIcon />                        </IconButton>
                        </Badge>

                    </div>

                    {mediaError && <div style={{ color: 'red', margin: '12px 0', textAlign: 'center' }}>{mediaError}</div>}

                    <video className={styles.meetUserVideo} ref={meetingVideoRef} autoPlay muted playsInline style={{ border: '2px solid #fff', width: '320px', height: '240px', backgroundColor: 'black' }}></video>
                    <div style={{ color: 'lightgreen', margin: '12px 0', textAlign: 'center' }}>
                        Local stream: {localStream ? 'active' : 'none'} | video tracks: {videoTrackCount} | audio tracks: {audioTrackCount}
                    </div>
                    <div style={{ color: 'white', margin: '4px 0', textAlign: 'center' }}>
                        Socket URL: {server_url}
                    </div>
                    <div style={{ color: 'white', margin: '4px 0', textAlign: 'center' }}>
                        Socket status: {socketStatus} {socketError ? `| ${socketError}` : ''}
                    </div>

                    <div className={styles.conferenceView}>
                        {videos.map((video) => (
                            <div key={video.socketId}>
                                <video
                                    data-socket={video.socketId}
                                    ref={ref => {
                                        if (ref && video.stream) {
                                            ref.srcObject = video.stream;
                                        }
                                    }}
                                    autoPlay
                                />
                            </div>
                        ))}
                    </div>

                </div>

            }

        </div>
    )
}
