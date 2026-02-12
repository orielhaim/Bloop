import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { leaveCallSession } from '../services/callService';

export const useCallStore = create(
  immer((set) => ({
    callState: 'idle', // idle, calling, incoming, in-call
    callerNumber: null,
    targetNumber: null,
    callRoom: null,
    callPassword: null,
    relayConnection: null,

    setRelayConnection: (conn) => set((state) => {
      state.relayConnection = conn;
    }),

    startCalling: (targetNumber, callRoom, callPassword) => set((state) => {
      state.callState = 'calling';
      state.targetNumber = targetNumber;
      state.callRoom = callRoom;
      state.callPassword = callPassword;
    }),

    receiveIncomingCall: (callerNumber, callRoom, callPassword) => set((state) => {
      if (state.callState !== 'idle') return; // Ignore if busy
      state.callState = 'incoming';
      state.callerNumber = callerNumber;
      state.callRoom = callRoom;
      state.callPassword = callPassword;
    }),

    answerCall: () => set((state) => {
      state.callState = 'in-call';
    }),

    rejectCall: () => set((state) => {
      state.callState = 'idle';
      state.callerNumber = null;
      state.callRoom = null;
      state.callPassword = null;
    }),

    hangUp: () => set((state) => {
      state.callState = 'idle';
      state.callerNumber = null;
      state.targetNumber = null;
      state.callRoom = null;
      state.callPassword = null;
      leaveCallSession();
    }),

    resetToIdle: () => set((state) => {
      state.callState = 'idle';
      state.callerNumber = null;
      state.targetNumber = null;
      state.callRoom = null;
      state.callPassword = null;
    })
  }))
);
