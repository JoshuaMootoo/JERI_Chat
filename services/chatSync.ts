
import { Message } from '../types';

type MessageHandler = (message: Message) => void;

class ChatSync {
  private channel: BroadcastChannel | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private roomId: string | null = null;

  connect(roomId: string) {
    this.roomId = roomId;
    this.channel = new BroadcastChannel(`jeri_chat_room_${roomId}`);
    this.channel.onmessage = (event) => {
      this.handlers.forEach(handler => handler(event.data));
    };
  }

  disconnect() {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.roomId = null;
    this.handlers.clear();
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  broadcast(message: Message) {
    if (this.channel) {
      this.channel.postMessage(message);
    }
  }
}

export const chatSync = new ChatSync();
