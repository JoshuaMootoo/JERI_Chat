
import { Message } from '../types';
import { supabase } from './supabase';
import { RealtimeChannel } from '@supabase/supabase-js';

type MessageHandler = (message: any) => void;

class ChatSync {
  private roomChannel: RealtimeChannel | null = null;
  private systemChannel: RealtimeChannel | null = null;
  private handlers: Set<MessageHandler> = new Set();
  private systemHandlers: Set<MessageHandler> = new Set();

  constructor() {
    // Global system channel for ephemeral friend requests/alerts
    this.systemChannel = supabase.channel('jeri_chat_global_system')
      .on('broadcast', { event: 'system_event' }, (payload) => {
        this.systemHandlers.forEach(handler => handler(payload.payload));
      })
      .subscribe();
  }

  async connect(roomId: string) {
    if (this.roomChannel) {
      await this.roomChannel.unsubscribe();
    }

    // Subscribe to new rows in the 'messages' table for this specific room
    this.roomChannel = supabase.channel(`room_db_${roomId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `room_id=eq.${roomId}`
        },
        (payload) => {
          const dbMsg = payload.new;
          const message: Message = {
            id: dbMsg.id,
            sender: dbMsg.sender_username,
            senderEmail: dbMsg.sender_email,
            senderLanguage: dbMsg.sender_language,
            text: dbMsg.text,
            timestamp: new Date(dbMsg.created_at).getTime()
          };
          this.handlers.forEach(handler => handler(message));
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.debug(`Successfully connected to room: ${roomId}`);
        }
      });
  }

  disconnect() {
    if (this.roomChannel) {
      this.roomChannel.unsubscribe();
      this.roomChannel = null;
    }
    this.handlers.clear();
  }

  onMessage(handler: MessageHandler) {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  onSystemEvent(handler: MessageHandler) {
    this.systemHandlers.add(handler);
    return () => { this.systemHandlers.delete(handler); };
  }

  async sendMessage(roomId: string, message: Omit<Message, 'id' | 'timestamp'>) {
    const { error } = await supabase
      .from('messages')
      .insert([{
        room_id: roomId,
        sender_email: message.senderEmail,
        sender_username: message.sender,
        sender_language: message.senderLanguage,
        text: message.text
      }]);
    
    if (error) {
      console.error("Supabase Error:", error);
      throw error;
    }
  }

  broadcastSystem(event: any) {
    if (this.systemChannel) {
      this.systemChannel.send({
        type: 'broadcast',
        event: 'system_event',
        payload: event,
      });
    }
  }

  async fetchHistory(roomId: string): Promise<Message[]> {
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(50);

    if (error) {
      // Rethrow so the UI can catch PGRST205 (missing table)
      throw error;
    }

    return (data || []).map(dbMsg => ({
      id: dbMsg.id,
      sender: dbMsg.sender_username,
      senderEmail: dbMsg.sender_email,
      senderLanguage: dbMsg.sender_language,
      text: dbMsg.text,
      timestamp: new Date(dbMsg.created_at).getTime()
    }));
  }
}

export const chatSync = new ChatSync();
