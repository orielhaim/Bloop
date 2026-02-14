import { joinRoom } from 'trystero/mqtt';
import { useCallStore } from '../store/callStore';
import { getSettings } from './settings';

let currentRoomId = null;
let room = null;
let localAudioStream = null;
let sendVideoState = null;
let getVideoState = null;

function buildConfig(settings, callPassword) {
  const config = {
    appId: 'bloop',
    password: callPassword || undefined,
  };

  if (settings.turnServer?.enabled) {
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

  return config;
}

function stopAllTracks(stream) {
  if (!stream) return;
  stream.getTracks().forEach(track => {
    track.stop();
    stream.removeTrack(track);
  });
}

function cleanupLocalVideo() {
  const { localVideoTrack } = useCallStore.getState();
  if (localVideoTrack) {
    localVideoTrack.stop();
    useCallStore.getState().disableLocalVideo();
  }
}


export async function startCallSession(
  callRoom,
  callPassword,
  onStatusChange,
  onRemoteStream,
) {
  if (currentRoomId === callRoom && room) {
    console.warn('[call] Already in room, skipping rejoin');
    return;
  }

  if (room) {
    leaveCallSession();
  }

  currentRoomId = callRoom;

  const settings = await getSettings();
  const config = buildConfig(settings, callPassword);

  room = joinRoom(config, callRoom);

  const [_sendVideoState, _getVideoState] = room.makeAction('videoState');
  sendVideoState = _sendVideoState;
  getVideoState = _getVideoState;

  getVideoState((enabled, peerId) => {
    console.log(`[call] Peer ${peerId} video state:`, enabled);
    if (!enabled) {
      useCallStore.getState().clearRemoteVideoStream();
    }
  });

  room.onPeerJoin(peerId => {
    console.log('[call] Peer joined:', peerId);
    onStatusChange('Connected');

    const store = useCallStore.getState();
    if (store.callState === 'calling') {
      store.answerCall();
    }

    if (localAudioStream) {
      room.addStream(localAudioStream, peerId);
    }
  });

  room.onPeerLeave(peerId => {
    console.log('[call] Peer left:', peerId);
    onStatusChange('Call Ended');
    useCallStore.getState().clearRemoteVideoStream();
    setTimeout(() => useCallStore.getState().hangUp(), 1000);
  });

  room.onPeerStream((stream, peerId, metadata) => {
    console.log('[call] Received stream from', peerId, 'metadata:', metadata);

    if (metadata?.type === 'video') {
      useCallStore.getState().setRemoteVideoStream(stream);
    } else {
      onRemoteStream(stream);
    }
  });

  room.onPeerTrack((track, stream, peerId, metadata) => {
    console.log('[call] Received track', track.kind, 'from', peerId, 'metadata:', metadata);

    if (track.kind === 'video') {
      useCallStore.getState().setRemoteVideoStream(stream);

      const onTrackGone = () => {
        console.log('[call] Remote video track ended/muted');
        useCallStore.getState().clearRemoteVideoStream();
      };

      track.addEventListener('ended', onTrackGone, { once: true });
      track.addEventListener('mute', onTrackGone, { once: true });
    } else {
      onRemoteStream(stream);
    }
  });

  try {
    localAudioStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });

    useCallStore.getState().setLocalStream(localAudioStream);

    room.addStream(localAudioStream);

    return localAudioStream;
  } catch (err) {
    console.error('[call] Microphone access failed:', err);
    onStatusChange('Microphone Error');
    throw err;
  }
}

export async function enableVideo() {
  if (!room || !localAudioStream) {
    console.warn('[call] Cannot enable video — no active room or audio stream');
    return null;
  }

  try {
    const videoStream = await navigator.mediaDevices.getUserMedia({
      video: true,
    });
    const videoTrack = videoStream.getVideoTracks()[0];

    room.addTrack(videoTrack, localAudioStream, null, { type: 'video' });

    useCallStore.getState().enableLocalVideo(videoTrack);

    sendVideoState?.(true);

    return videoTrack;
  } catch (err) {
    console.error('[call] Failed to enable video:', err);
    throw err;
  }
}

export function disableVideo() {
  const { localVideoTrack } = useCallStore.getState();
  if (!localVideoTrack || !room) return;

  sendVideoState?.(false);

  room.removeTrack(localVideoTrack);
  localVideoTrack.stop();
  useCallStore.getState().disableLocalVideo();
}

export function leaveCallSession() {
  cleanupLocalVideo();

  if (localAudioStream) {
    stopAllTracks(localAudioStream);
    localAudioStream = null;
  }

  if (room) {
    room.leave();
    room = null;
    currentRoomId = null;
  }

  sendVideoState = null;
  getVideoState = null;
}
