import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { leaveCallSession } from '../services/callService';
import { addCallRecord } from '../services/callHistory';

export const useCallStore = create(
  immer((set, get) => ({
    callState: 'idle', // idle, calling, incoming, in-call
    callerNumber: null,
    targetNumber: null,
    callRoom: null,
    callPassword: null,
    relayConnection: null,
    callStartedAt: null,
    callConnectedAt: null,
    historyUpdatedAt: null,
    contactsUpdatedAt: null,

    // Media State
    localStream: null,
    localVideoTrack: null,
    remoteVideoStream: null,
    isLocalVideoEnabled: false,
    isRemoteVideoPresent: false,

    setLocalStream: (stream) => set((state) => {
      state.localStream = stream;
    }),

    enableLocalVideo: (track) => set((state) => {
      state.localVideoTrack = track;
      state.isLocalVideoEnabled = true;
    }),

    disableLocalVideo: () => set((state) => {
      state.localVideoTrack = null;
      state.isLocalVideoEnabled = false;
    }),

    setRemoteVideoStream: (stream) => set((state) => {
      state.remoteVideoStream = stream;
      state.isRemoteVideoPresent = true;
    }),

    clearRemoteVideoStream: () => set((state) => {
      state.remoteVideoStream = null;
      state.isRemoteVideoPresent = false;
    }),

    setRelayConnection: (conn) => set((state) => {
      state.relayConnection = conn;
    }),

    setContactsUpdatedAt: (timestamp) => set((state) => {
      state.contactsUpdatedAt = timestamp;
    }),

    startCalling: (targetNumber, callRoom, callPassword) => set((state) => {
      state.callState = 'calling';
      state.targetNumber = targetNumber;
      state.callRoom = callRoom;
      state.callPassword = callPassword;
      state.callStartedAt = Date.now();
      state.callConnectedAt = null;
    }),

    receiveIncomingCall: (callerNumber, callRoom, callPassword) => set((state) => {
      if (state.callState !== 'idle') return; // Ignore if busy
      state.callState = 'incoming';
      state.callerNumber = callerNumber;
      state.callRoom = callRoom;
      state.callPassword = callPassword;
      state.callStartedAt = Date.now();
      state.callConnectedAt = null;
    }),

    answerCall: () => set((state) => {
      state.callState = 'in-call';
      if (!state.callConnectedAt) {
        state.callConnectedAt = Date.now();
      }
    }),

    rejectCall: () => {
      const state = get();
      if (state.callerNumber) {
        const endedAt = Date.now();
        const record = {
          id: crypto.randomUUID(),
          direction: 'incoming',
          number: state.callerNumber,
          status: 'rejected',
          startedAt: state.callStartedAt || endedAt,
          connectedAt: null,
          endedAt,
          durationSec: 0
        };
        addCallRecord(record)
          .then(() => {
            set((draft) => {
              draft.historyUpdatedAt = endedAt;
            });
          })
          .catch(console.error);
      }
      set((draft) => {
        draft.callState = 'idle';
        draft.callerNumber = null;
        draft.callRoom = null;
        draft.callPassword = null;
        draft.callStartedAt = null;
        draft.callConnectedAt = null;
      });
    },

    hangUp: () => {
      const state = get();
      const number = state.targetNumber || state.callerNumber;
      if (number) {
        const endedAt = Date.now();
        const status = state.callConnectedAt ? 'answered' : 'ignored';
        const record = {
          id: crypto.randomUUID(),
          direction: state.targetNumber ? 'outgoing' : 'incoming',
          number,
          status,
          startedAt: state.callStartedAt || endedAt,
          connectedAt: state.callConnectedAt,
          endedAt,
          durationSec: state.callConnectedAt ? Math.max(0, Math.floor((endedAt - state.callConnectedAt) / 1000)) : 0
        };
        addCallRecord(record)
          .then(() => {
            set((draft) => {
              draft.historyUpdatedAt = endedAt;
            });
          })
          .catch(console.error);
      }
      set((draft) => {
        draft.callState = 'idle';
        draft.callerNumber = null;
        draft.targetNumber = null;
        draft.callRoom = null;
        draft.callPassword = null;
        draft.callStartedAt = null;
        draft.callConnectedAt = null;
        draft.localStream = null;
        draft.localVideoTrack = null;
        draft.remoteVideoStream = null;
        draft.isLocalVideoEnabled = false;
        draft.isRemoteVideoPresent = false;
      });
      leaveCallSession();
    },

    ignoreCall: () => {
      const state = get();
      if (state.callerNumber) {
        const endedAt = Date.now();
        const record = {
          id: crypto.randomUUID(),
          direction: 'incoming',
          number: state.callerNumber,
          status: 'ignored',
          startedAt: state.callStartedAt || endedAt,
          connectedAt: null,
          endedAt,
          durationSec: 0
        };
        addCallRecord(record)
          .then(() => {
            set((draft) => {
              draft.historyUpdatedAt = endedAt;
            });
          })
          .catch(console.error);
      }
      set((draft) => {
        draft.callState = 'idle';
        draft.callerNumber = null;
        draft.targetNumber = null;
        draft.callRoom = null;
        draft.callPassword = null;
        draft.callStartedAt = null;
        draft.callConnectedAt = null;
      });
    },

    resetToIdle: () => set((state) => {
      state.callState = 'idle';
      state.callerNumber = null;
      state.targetNumber = null;
      state.callRoom = null;
      state.callPassword = null;
      state.callStartedAt = null;
      state.callConnectedAt = null;
      state.localStream = null;
      state.localVideoTrack = null;
      state.remoteVideoStream = null;
      state.isLocalVideoEnabled = false;
      state.isRemoteVideoPresent = false;
    })
  }))
);
