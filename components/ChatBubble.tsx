
import React, { useState } from 'react';
import { TranslatedMessage } from '../types';
import { SUPPORTED_LANGUAGES } from '../constants';

interface ChatBubbleProps {
  message: TranslatedMessage;
  isOwn: boolean;
  targetLanguage: string;
}

const ChatBubble: React.FC<ChatBubbleProps> = ({ message, isOwn, targetLanguage }) => {
  const [showOriginal, setShowOriginal] = useState(false);
  
  const senderLang = SUPPORTED_LANGUAGES.find(l => l.code === message.senderLanguage)?.name || message.senderLanguage;
  const targetLangName = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage)?.name || targetLanguage;

  const displayContent = showOriginal ? message.text : (message.translatedText || message.text);
  const isTranslated = !isOwn && message.senderLanguage !== targetLanguage && !showOriginal;

  return (
    <div className={`flex flex-col mb-4 ${isOwn ? 'items-end' : 'items-start'}`}>
      <div className="flex items-center space-x-2 mb-1 px-1">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
          {message.sender}
        </span>
        <span className="text-[10px] text-gray-400">
          {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
      
      <div 
        className={`max-w-[80%] px-4 py-2.5 rounded-2xl shadow-sm relative group ${
          isOwn 
            ? 'bg-indigo-600 text-white rounded-tr-none' 
            : 'bg-white text-gray-800 rounded-tl-none border border-gray-100'
        }`}
      >
        {message.isTranslating ? (
          <div className="flex space-x-1 py-1">
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce"></div>
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
            <div className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
          </div>
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{displayContent}</p>
        )}

        {isTranslated && !message.isTranslating && (
          <div className="mt-1 pt-1 border-t border-gray-100 flex items-center justify-between">
             <span className="text-[9px] italic opacity-70">
              Translated from {senderLang}
            </span>
            <button 
              onClick={() => setShowOriginal(!showOriginal)}
              className="text-[9px] font-bold underline opacity-80 hover:opacity-100 transition-opacity"
            >
              Show Original
            </button>
          </div>
        )}
        
        {showOriginal && (
          <div className="mt-1 pt-1 border-t border-gray-100 flex items-center justify-between">
            <span className="text-[9px] italic opacity-70">
              Original text
            </span>
            <button 
              onClick={() => setShowOriginal(false)}
              className="text-[9px] font-bold underline opacity-80 hover:opacity-100 transition-opacity"
            >
              Show Translation
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatBubble;
