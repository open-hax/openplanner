import { io, Socket } from 'socket.io-client';

export interface Envelope {
  'event/id'?: string;
  'event/type': string;
  'event/time'?: string;
  'causal/root'?: string;
  'session/id'?: string;
  payload?: Record<string, unknown>;
}

export class OpenPlannerClient {
  private socket: Socket;
  private rooms: Set<string> = new Set();

  constructor(url: string, opts?: { auth?: { token: string } }) {
    this.socket = io(url, opts);
  }

  emit(eventType: string, payload: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const envelope: Envelope = {
        'event/id': crypto.randomUUID(),
        'event/type': eventType,
        'event/time': new Date().toISOString(),
        'causal/root': crypto.randomUUID(),
        payload,
      };

      const timeout = setTimeout(() => {
        reject(new Error(`Socket.IO timeout for ${eventType}`));
      }, 30000);

      this.socket.emit(eventType, envelope, (response: unknown) => {
        clearTimeout(timeout);
        resolve(response);
      });
    });
  }

  on(eventType: string, callback: (event: Envelope) => void): void {
    this.socket.on(eventType, callback);
  }

  off(eventType: string, callback?: (event: Envelope) => void): void {
    this.socket.off(eventType, callback);
  }

  joinRoom(roomId: string): void {
    this.socket.emit('room:join', roomId);
    this.rooms.add(roomId);
  }

  leaveRoom(roomId: string): void {
    this.socket.emit('room:leave', roomId);
    this.rooms.delete(roomId);
  }

  disconnect(): void {
    this.socket.disconnect();
  }
}
