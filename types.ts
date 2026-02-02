
export interface User {
  username: string;
  email: string;
  preferredLanguage: string;
  friends: string[]; // Array of emails
  friendRequests: string[]; // Array of emails
}

export interface Message {
  id: string;
  sender: string;
  senderEmail: string;
  senderLanguage: string;
  text: string;
  timestamp: number;
}

export interface TranslatedMessage extends Message {
  translatedText?: string;
  isTranslating?: boolean;
}

export interface ChatRoom {
  id: string;
  name: string;
  isDirect?: boolean;
}

export interface Language {
  code: string;
  name: string;
  nativeName: string;
}
