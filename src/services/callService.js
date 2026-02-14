import { joinRoom } from 'trystero/mqtt';
import { useCallStore } from '../store/callStore';
import { getSettings } from './settings';

let roomId = null;
let room = null;
let localStream = null;

export async function startCallSession(callRoom, callPassword, onStatusChange, onRemoteStream) {
  if (roomId === callRoom) {
    console.warn("Same room, not rejoining");
    return;
  }

  roomId = callRoom;

  if (room) {
    console.warn("Room already exists, leaving first");
    leaveCallSession();
  }

  const settings = await getSettings();
  const config = { appId: 'bloop-p2p-phone', password: callPassword };

  if (settings.turnServer && settings.turnServer.enabled) {
    config.rtcConfig = {
      iceTransportPolicy: 'relay',
      iceServers: [
        {
          urls: settings.turnServer.urls,
          username: settings.turnServer.username,
          credential: settings.turnServer.credential
        }
      ]
    };
  }

  room = joinRoom(config, callRoom);

  room.onPeerJoin(peerId => {
    console.log('Peer joined', peerId);
    onStatusChange('Connected');
    if (useCallStore.getState().callState === 'calling') {
      useCallStore.getState().answerCall();
    }
  });

  room.onPeerLeave(peerId => {
    console.log('Peer left', peerId);
    onStatusChange('Call Ended');
    setTimeout(() => {
      useCallStore.getState().hangUp();
    }, 1000);
  });

  room.onPeerStream((stream, peerId) => {
    console.log('Received stream from', peerId);
    onRemoteStream(stream);
  });

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    room.addStream(localStream);
    return localStream;
  } catch (err) {
    console.error("Failed to get microphone", err);
    onStatusChange('Microphone Error');
    throw err;
  }
}

export function leaveCallSession() {
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  if (room) {
    room.leave();
    room = null;
    roomId = null;
  }
}
